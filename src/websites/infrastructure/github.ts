// Reads from and commits to a site's repository through GitHub's REST API.
// A commit is made from blobs, a tree and a commit object, then the branch
// is moved to it: one commit for the content file and every photo, so the
// site never builds from half a change.
//
// The token is a fine-grained personal access token with "Contents: read
// and write" on the client sites' repositories only. Commits are made as
// the token's owner.
import type { RepoError, SitePublisher } from "../application/ports.ts";
import type { Repo } from "../domain/site.ts";
import { err, ok, type Result } from "../../shared/index.ts";

const API = "https://api.github.com";
const TIMEOUT_MS = 20_000;

export type GithubConfig = { readonly token: string };

/**
 * null when publishing is not set up.
 *   HQ_GITHUB_TOKEN   a token that may read and write the client sites' repositories
 */
export function githubConfigFrom(env: NodeJS.ProcessEnv): GithubConfig | null {
  const token = (env["HQ_GITHUB_TOKEN"] ?? "").trim();
  if (!token) return null;
  if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new Error("HQ_GITHUB_TOKEN doesn't look like a GitHub token.");
  return { token };
}

const segments = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export function githubPublisher(config: GithubConfig, deps: { fetch?: typeof fetch } = {}): SitePublisher {
  const send = deps.fetch ?? fetch;

  /** One call. The answer's status and body, or `repo-failed` when GitHub could not be reached. */
  async function call(method: string, path: string, options: { body?: unknown; raw?: boolean } = {}): Promise<Result<{ status: number; response: Response }, RepoError>> {
    try {
      const response = await send(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${config.token}`,
          accept: options.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "potomac-hq",
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return ok({ status: response.status, response });
    } catch {
      return err("repo-failed");
    }
  }

  /** What a refusal means. The body is never kept: it may quote the request. */
  const refusal = (status: number): RepoError => (status === 401 || status === 403 ? "repo-refused" : status === 404 ? "repo-missing" : status === 409 || status === 422 ? "repo-changed" : "repo-failed");

  /** A call that answers JSON with a `sha`, or some other text field. */
  async function json<T>(method: string, path: string, body?: unknown): Promise<Result<T, RepoError>> {
    const made = await call(method, path, body === undefined ? {} : { body });
    if (!made.ok) return made;
    if (made.value.status < 200 || made.value.status >= 300) return err(refusal(made.value.status));
    try {
      return ok((await made.value.response.json()) as T);
    } catch {
      return err("repo-failed");
    }
  }

  const base = (repo: Repo) => `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

  async function commitOnce(repo: Repo, change: Parameters<SitePublisher["commit"]>[1]): Promise<Result<{ commit: string }, RepoError>> {
    const ref = await json<{ object?: { sha?: string } }>("GET", `${base(repo)}/git/ref/heads/${segments(repo.branch)}`);
    if (!ref.ok) return ref;
    const head = ref.value.object?.sha;
    if (!head) return err("repo-failed");
    const parent = await json<{ tree?: { sha?: string } }>("GET", `${base(repo)}/git/commits/${head}`);
    if (!parent.ok) return parent;
    const baseTree = parent.value.tree?.sha;
    if (!baseTree) return err("repo-failed");

    const entries: { path: string; mode: "100644"; type: "blob"; sha: string | null }[] = [];
    for (const file of change.write) {
      const blob = await json<{ sha?: string }>("POST", `${base(repo)}/git/blobs`, { content: Buffer.from(file.bytes).toString("base64"), encoding: "base64" });
      if (!blob.ok) return blob;
      if (!blob.value.sha) return err("repo-failed");
      entries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.value.sha });
    }
    // A null sha removes the file from the tree.
    for (const path of change.remove) entries.push({ path, mode: "100644", type: "blob", sha: null });

    const tree = await json<{ sha?: string }>("POST", `${base(repo)}/git/trees`, { base_tree: baseTree, tree: entries });
    if (!tree.ok) return tree;
    if (!tree.value.sha) return err("repo-failed");
    const commit = await json<{ sha?: string }>("POST", `${base(repo)}/git/commits`, { message: change.message, tree: tree.value.sha, parents: [head] });
    if (!commit.ok) return commit;
    if (!commit.value.sha) return err("repo-failed");
    // Never forced: if the branch moved since it was read, GitHub refuses and nothing is lost.
    const moved = await json<{ object?: { sha?: string } }>("PATCH", `${base(repo)}/git/refs/heads/${segments(repo.branch)}`, { sha: commit.value.sha, force: false });
    if (!moved.ok) return moved;
    return ok({ commit: commit.value.sha });
  }

  return {
    async read(repo, path) {
      const made = await call("GET", `${base(repo)}/contents/${segments(path)}?ref=${encodeURIComponent(repo.branch)}`, { raw: true });
      if (!made.ok) return made;
      if (made.value.status !== 200) return err(refusal(made.value.status));
      try {
        return ok(new Uint8Array(await made.value.response.arrayBuffer()));
      } catch {
        return err("repo-failed");
      }
    },
    async commit(repo, change) {
      const first = await commitOnce(repo, change);
      // Someone else's commit landed in between: read the branch again and try once more.
      return !first.ok && first.error === "repo-changed" ? commitOnce(repo, change) : first;
    },
  };
}

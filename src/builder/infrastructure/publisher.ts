// Puts a site builder version on GitHub (decision 0010, slice 4): making a
// private repository under the organization, one commit of the files, and a
// pull request into a client's own repository. A commit is made from blobs,
// a tree and a commit object, then the branch is moved to it, never forced,
// so a branch that moved in between is refused rather than overwritten.
//
// Two tokens. HQ_GITHUB_ADMIN_TOKEN makes repositories and commits to the
// ones the builder made. HQ_GITHUB_TOKEN, the everyday one, commits to a
// client's existing repository and opens the pull request.
import type { PublishError, RepoName, SitePublishing } from "../application/ports.ts";

const API = "https://api.github.com";
const TIMEOUT_MS = 30_000;

export type PublisherConfig = { readonly token: string | null; readonly adminToken: string | null; readonly organization: string };

/**
 *   HQ_GITHUB_ADMIN_TOKEN   may make repositories in the organization, and write to them
 *   HQ_GITHUB_ORG           the organization: Potomac-Solutions unless set
 */
export function publisherConfigFrom(env: NodeJS.ProcessEnv, everyday: string | null): PublisherConfig {
  const admin = (env["HQ_GITHUB_ADMIN_TOKEN"] ?? "").trim();
  if (admin && !/^[A-Za-z0-9_]{20,255}$/.test(admin)) throw new Error("HQ_GITHUB_ADMIN_TOKEN doesn't look like a GitHub token.");
  const organization = (env["HQ_GITHUB_ORG"] ?? "").trim() || "Potomac-Solutions";
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(organization)) throw new Error("HQ_GITHUB_ORG must be a GitHub organization's name.");
  return { token: everyday, adminToken: admin || null, organization };
}

const seg = (text: string) => text.split("/").map(encodeURIComponent).join("/");
const refusal = (status: number): PublishError => (status === 401 || status === 403 ? "repo-refused" : status === 404 ? "repo-missing" : status === 409 || status === 422 ? "repo-changed" : "repo-failed");
type R<T> = { ok: true; value: T } | { ok: false; error: PublishError };

export function githubSitePublishing(config: PublisherConfig, deps: { readonly fetch?: typeof fetch } = {}): SitePublishing {
  const send = deps.fetch ?? fetch;
  async function call<T>(admin: boolean, method: string, path: string, body?: unknown): Promise<R<T>> {
    const token = admin ? config.adminToken : config.token;
    if (!token) return { ok: false, error: admin ? "admin-not-set-up" : "everyday-not-set-up" };
    try {
      const response = await send(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "potomac-hq", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, error: refusal(response.status) };
      }
      return { ok: true, value: (response.status === 204 ? {} : await response.json()) as T };
    } catch {
      return { ok: false, error: "repo-failed" };
    }
  }
  const base = (repo: RepoName) => `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const headOf = async (repo: RepoName, branch: string, admin: boolean): Promise<R<string>> => {
    const ref = await call<{ object?: { sha?: string } }>(admin, "GET", `${base(repo)}/git/ref/heads/${seg(branch)}`);
    if (!ref.ok) return ref;
    return ref.value.object?.sha ? { ok: true, value: ref.value.object.sha } : { ok: false, error: "repo-failed" };
  };

  return {
    organization: config.organization,
    canCreate: config.adminToken !== null,
    async createRepo(name, description) {
      if (!config.adminToken) return { ok: false, error: "admin-not-set-up" };
      // A name already taken is refused by GitHub with 422; say so plainly.
      const taken = await call<unknown>(true, "GET", base({ owner: config.organization, name }));
      if (taken.ok) return { ok: false, error: "repo-exists" };
      const made = await call<{ default_branch?: string }>(true, "POST", `/orgs/${encodeURIComponent(config.organization)}/repos`, { name, description, private: true, auto_init: true, has_wiki: false, has_projects: false });
      if (!made.ok) return made.error === "repo-changed" ? { ok: false, error: "repo-exists" } : made;
      return { ok: true, value: { branch: made.value.default_branch ?? "main" } };
    },
    async defaultBranch(repo, admin) {
      const about = await call<{ default_branch?: string }>(admin, "GET", base(repo));
      if (!about.ok) return about;
      return about.value.default_branch ? { ok: true, value: about.value.default_branch } : { ok: false, error: "repo-failed" };
    },
    async commit(repo, change, admin) {
      let head: R<string>;
      let fresh = false;
      if (change.from) {
        const existing = await call<{ object?: { sha?: string } }>(admin, "GET", `${base(repo)}/git/ref/heads/${seg(change.branch)}`);
        if (existing.ok) return { ok: false, error: "repo-changed" };
        head = await headOf(repo, change.from, admin);
        fresh = true;
      } else {
        head = await headOf(repo, change.branch, admin);
      }
      if (!head.ok) return head;
      const parent = await call<{ tree?: { sha?: string } }>(admin, "GET", `${base(repo)}/git/commits/${head.value}`);
      if (!parent.ok) return parent;
      if (!parent.value.tree?.sha) return { ok: false, error: "repo-failed" };
      const entries: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
      for (const file of change.write) {
        const blob = await call<{ sha?: string }>(admin, "POST", `${base(repo)}/git/blobs`, { content: Buffer.from(file.bytes).toString("base64"), encoding: "base64" });
        if (!blob.ok) return blob;
        if (!blob.value.sha) return { ok: false, error: "repo-failed" };
        entries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.value.sha });
      }
      const tree = await call<{ sha?: string }>(admin, "POST", `${base(repo)}/git/trees`, { base_tree: parent.value.tree?.sha, tree: entries });
      if (!tree.ok) return tree;
      const commit = await call<{ sha?: string }>(admin, "POST", `${base(repo)}/git/commits`, { message: change.message, tree: tree.value.sha, parents: [head.value] });
      if (!commit.ok) return commit;
      if (!commit.value.sha) return { ok: false, error: "repo-failed" };
      const moved = fresh
        ? await call<unknown>(admin, "POST", `${base(repo)}/git/refs`, { ref: `refs/heads/${change.branch}`, sha: commit.value.sha })
        : await call<unknown>(admin, "PATCH", `${base(repo)}/git/refs/heads/${seg(change.branch)}`, { sha: commit.value.sha, force: false });
      if (!moved.ok) return moved;
      return { ok: true, value: { commit: commit.value.sha } };
    },
    async pullRequest(repo, request) {
      const made = await call<{ html_url?: string; number?: number }>(false, "POST", `${base(repo)}/pulls`, request);
      if (!made.ok) return made;
      return made.value.html_url && typeof made.value.number === "number" ? { ok: true, value: { url: made.value.html_url, number: made.value.number } } : { ok: false, error: "repo-failed" };
    },
  };
}

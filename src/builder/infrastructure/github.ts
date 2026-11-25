// The site builder's way to GitHub: reading a repository to rework (slice
// 3). Uses HQ_GITHUB_TOKEN, the same token that publishes clients' site
// content (decision 0003), so it reads only the repositories that token may.
import type { RepoError, RepoReader } from "../application/ports.ts";

const API = "https://api.github.com";
const TIMEOUT_MS = 20_000;

export type BuilderGithubConfig = { readonly token: string };

const seg = (text: string) => text.split("/").map(encodeURIComponent).join("/");
const refusal = (status: number): RepoError => (status === 401 || status === 403 ? "repo-refused" : status === 404 || status === 409 ? "repo-missing" : "repo-failed");

export function builderGithub(config: BuilderGithubConfig, deps: { readonly fetch?: typeof fetch } = {}): RepoReader {
  const send = deps.fetch ?? fetch;
  async function get(path: string, raw = false): Promise<{ ok: true; value: Response } | { ok: false; error: RepoError }> {
    try {
      const response = await send(`${API}${path}`, {
        headers: { authorization: `Bearer ${config.token}`, accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "potomac-hq" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, error: refusal(response.status) };
      }
      return { ok: true, value: response };
    } catch {
      return { ok: false, error: "repo-failed" };
    }
  }
  return {
    async tree(repo) {
      const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
      let branch = repo.branch;
      if (!branch) {
        const about = await get(base);
        if (!about.ok) return about;
        const body = (await about.value.json().catch(() => ({}))) as { default_branch?: unknown };
        if (typeof body.default_branch !== "string") return { ok: false, error: "repo-failed" };
        branch = body.default_branch;
      }
      const listed = await get(`${base}/git/trees/${seg(branch)}?recursive=1`);
      if (!listed.ok) return listed;
      const body = (await listed.value.json().catch(() => ({}))) as { tree?: unknown };
      const tree = Array.isArray(body.tree) ? body.tree : [];
      const files = tree.flatMap((one: { type?: unknown; path?: unknown; size?: unknown; sha?: unknown }) =>
        one.type === "blob" && typeof one.path === "string" && typeof one.sha === "string" && typeof one.size === "number" ? [{ path: one.path, size: one.size, sha: one.sha }] : [],
      );
      return { ok: true, value: { branch, files } };
    },
    async blob(repo, sha) {
      if (!/^[0-9a-f]{40,64}$/.test(sha)) return { ok: false, error: "repo-missing" };
      const got = await get(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/git/blobs/${sha}`, true);
      if (!got.ok) return got;
      return { ok: true, value: new Uint8Array(await got.value.arrayBuffer()) };
    },
  };
}

// A zip of a free page's code, for a client who wants to host it themselves
// (decision 0013, section 3). GitHub answers the zipball address with a
// redirect to a short-lived download; both are followed here, with the same
// token site content uses (read access is enough).
import type { SiteArchive } from "../application/ports.ts";

const MAX_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export function githubArchive(config: { readonly token: string }, deps: { fetch?: typeof fetch } = {}): SiteArchive {
  const send = deps.fetch ?? fetch;
  return async (repo) => {
    const path = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/zipball/${repo.branch.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const response = await send(`https://api.github.com${path}`, {
        headers: { authorization: `Bearer ${config.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "potomac-hq" },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status !== 200) return null;
      const length = Number(response.headers.get("content-length") ?? "0");
      if (length > MAX_BYTES) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length > 0 && bytes.length <= MAX_BYTES ? bytes : null;
    } catch {
      return null;
    }
  };
}

// A stand-in for a site's repository on GitHub: files by path, and every
// commit made to it. Tests give it to the app as its site publisher.
import type { SitePublisher } from "../../src/websites/index.ts";

export type FakeCommit = { readonly message: string; readonly wrote: readonly string[]; readonly removed: readonly string[] };

export function fakeSiteRepo(files: Record<string, string | Uint8Array>) {
  const held = new Map<string, Uint8Array>(Object.entries(files).map(([path, body]) => [path, typeof body === "string" ? new TextEncoder().encode(body) : body]));
  const commits: FakeCommit[] = [];
  const state = { failWith: null as "repo-refused" | "repo-failed" | "repo-changed" | null };
  const publisher: SitePublisher = {
    async read(_repo, path) {
      if (state.failWith) return { ok: false, error: state.failWith };
      const body = held.get(path);
      return body ? { ok: true, value: body } : { ok: false, error: "repo-missing" };
    },
    async commit(_repo, change) {
      if (state.failWith) return { ok: false, error: state.failWith };
      // As GitHub does: removing a file that is not there is refused.
      if (change.remove.some((path) => !held.has(path))) return { ok: false, error: "repo-changed" };
      for (const file of change.write) held.set(file.path, file.bytes);
      for (const path of change.remove) held.delete(path);
      commits.push({ message: change.message, wrote: change.write.map((file) => file.path), removed: [...change.remove] });
      return { ok: true, value: { commit: `commit${commits.length}` } };
    },
  };
  return {
    publisher,
    commits,
    state,
    has: (path: string) => held.has(path),
    text: (path: string) => new TextDecoder().decode(held.get(path) ?? new Uint8Array()),
    bytes: (path: string) => held.get(path) ?? null,
    set: (path: string, body: string) => void held.set(path, new TextEncoder().encode(body)),
  };
}

/** The first bytes of a JPEG and of a WebP: enough for HQ, which goes by them. */
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
export const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

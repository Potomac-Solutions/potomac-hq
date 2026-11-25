// The site builder's GitHub reader against a stand-in for GitHub's API.
import assert from "node:assert/strict";
import { test } from "node:test";
import { builderGithub } from "./github.ts";

test("a tree is read from the default branch, and a blob as raw bytes", async () => {
  const asked: string[] = [];
  const fake: typeof fetch = async (url, init) => {
    asked.push(`${String(url)} ${(init?.headers as Record<string, string>)["accept"]}`);
    const path = new URL(String(url)).pathname;
    if (path === "/repos/a/b") return Response.json({ default_branch: "trunk" });
    if (path === "/repos/a/b/git/trees/trunk") return Response.json({ tree: [{ type: "blob", path: "index.html", size: 10, sha: "a".repeat(40) }, { type: "tree", path: "css", sha: "b".repeat(40) }] });
    if (path === `/repos/a/b/git/blobs/${"a".repeat(40)}`) return new Response("<h1>Hi</h1>");
    return new Response("{}", { status: 404 });
  };
  const github = builderGithub({ token: "t".repeat(40) }, { fetch: fake });
  assert.deepEqual(await github.tree({ owner: "a", name: "b", branch: null }), { ok: true, value: { branch: "trunk", files: [{ path: "index.html", size: 10, sha: "a".repeat(40) }] } });
  const blob = await github.blob({ owner: "a", name: "b" }, "a".repeat(40));
  assert.ok(blob.ok);
  assert.equal(new TextDecoder().decode(blob.value), "<h1>Hi</h1>");
  assert.ok(asked.at(-1)?.endsWith("application/vnd.github.raw+json"));
  assert.deepEqual(await github.tree({ owner: "a", name: "c", branch: null }), { ok: false, error: "repo-missing" });
  assert.deepEqual(await github.blob({ owner: "a", name: "b" }, "../x"), { ok: false, error: "repo-missing" });
});

test("refusals and an unreachable GitHub are results, not errors", async () => {
  const refused = builderGithub({ token: "x" }, { fetch: async () => new Response("{}", { status: 403 }) });
  assert.deepEqual(await refused.tree({ owner: "a", name: "b", branch: "main" }), { ok: false, error: "repo-refused" });
  const down = builderGithub({ token: "x" }, { fetch: async () => { throw new TypeError("fetch failed"); } });
  assert.deepEqual(await down.tree({ owner: "a", name: "b", branch: "main" }), { ok: false, error: "repo-failed" });
});

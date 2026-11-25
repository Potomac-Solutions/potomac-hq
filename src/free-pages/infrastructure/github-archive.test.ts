import assert from "node:assert/strict";
import { test } from "node:test";
import { githubArchive } from "./github-archive.ts";

test("the zip is asked of GitHub with the token, for the branch; anything but a zip is nothing", async () => {
  const calls: { url: string; auth: string }[] = [];
  const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>)["authorization"] ?? "" });
    return url.includes("/missing/") ? new Response("no", { status: 404 }) : new Response(zip, { status: 200 });
  }) as unknown as typeof fetch;
  const archive = githubArchive({ token: "ghp_test" }, { fetch: fake });
  assert.deepEqual(await archive({ owner: "Potomac-Solutions", name: "moats", branch: "site/v2" }), zip);
  assert.deepEqual(calls[0], { url: "https://api.github.com/repos/Potomac-Solutions/moats/zipball/site/v2", auth: "Bearer ghp_test" });
  assert.equal(await archive({ owner: "a", name: "missing", branch: "main" }), null);
  const broken = githubArchive({ token: "t" }, { fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
  assert.equal(await broken({ owner: "a", name: "b", branch: "main" }), null);
});

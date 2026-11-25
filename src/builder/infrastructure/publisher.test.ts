// The GitHub publisher against a stand-in for GitHub's API: which token each
// call uses, a new branch made from the deploy branch, and a branch moved
// without force.
import assert from "node:assert/strict";
import { test } from "node:test";
import { githubSitePublishing, publisherConfigFrom } from "./publisher.ts";

const EVERYDAY = "e".repeat(40);
const ADMIN = "a".repeat(40);

function fakeGithub() {
  const seen: { method: string; path: string; token: string; body: unknown }[] = [];
  const refs = new Map([["production", "1".repeat(40)]]);
  const fake: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    seen.push({ method, path, token: String((init?.headers as Record<string, string>)["authorization"]).slice(7), body });
    if (method === "GET" && path === "/repos/Potomac-Solutions/new-site") return new Response("{}", { status: 404 });
    if (method === "POST" && path === "/orgs/Potomac-Solutions/repos") return Response.json({ default_branch: "main" }, { status: 201 });
    const ref = /\/git\/ref\/heads\/(.+)$/.exec(path);
    if (method === "GET" && ref) {
      const sha = refs.get(decodeURIComponent(ref[1] as string));
      return sha ? Response.json({ object: { sha } }) : new Response("{}", { status: 404 });
    }
    if (method === "GET" && path.includes("/git/commits/")) return Response.json({ tree: { sha: "2".repeat(40) } });
    if (method === "POST" && path.endsWith("/git/blobs")) return Response.json({ sha: "3".repeat(40) }, { status: 201 });
    if (method === "POST" && path.endsWith("/git/trees")) return Response.json({ sha: "4".repeat(40) }, { status: 201 });
    if (method === "POST" && path.endsWith("/git/commits")) return Response.json({ sha: "5".repeat(40) }, { status: 201 });
    if (method === "POST" && path.endsWith("/git/refs")) return Response.json({}, { status: 201 });
    if (method === "PATCH" && path.includes("/git/refs/heads/")) return Response.json({});
    if (method === "POST" && path.endsWith("/pulls")) return Response.json({ html_url: "https://github.com/c/s/pull/3", number: 3 }, { status: 201 });
    return new Response("{}", { status: 404 });
  };
  return { seen, fake };
}

test("the tokens and the organization are read from the environment", () => {
  assert.deepEqual(publisherConfigFrom({}, null), { token: null, adminToken: null, organization: "Potomac-Solutions" });
  assert.deepEqual(publisherConfigFrom({ HQ_GITHUB_ADMIN_TOKEN: ADMIN, HQ_GITHUB_ORG: "acme" }, EVERYDAY), { token: EVERYDAY, adminToken: ADMIN, organization: "acme" });
  assert.throws(() => publisherConfigFrom({ HQ_GITHUB_ADMIN_TOKEN: "nope" }, null), /doesn't look like a GitHub token/);
});

test("a new repository is made private with the admin token, and committed to with it", async () => {
  const { seen, fake } = fakeGithub();
  const github = githubSitePublishing({ token: EVERYDAY, adminToken: ADMIN, organization: "Potomac-Solutions" }, { fetch: fake });
  assert.deepEqual(await github.createRepo("new-site", "A site."), { ok: true, value: { branch: "main" } });
  const made = seen.find((one) => one.method === "POST" && one.path.endsWith("/repos"));
  assert.deepEqual([made?.token, (made?.body as { private: boolean }).private], [ADMIN, true]);
  const none = githubSitePublishing({ token: EVERYDAY, adminToken: null, organization: "Potomac-Solutions" }, { fetch: fake });
  assert.equal(none.canCreate, false);
  assert.deepEqual(await none.createRepo("x", ""), { ok: false, error: "admin-not-set-up" });
});

test("a version goes onto a new branch made from the deploy branch, then a pull request, with the everyday token", async () => {
  const { seen, fake } = fakeGithub();
  const github = githubSitePublishing({ token: EVERYDAY, adminToken: ADMIN, organization: "Potomac-Solutions" }, { fetch: fake });
  const repo = { owner: "c", name: "s" };
  const made = await github.commit(repo, { branch: "hq/site-builder-v2", from: "production", message: "v2", write: [{ path: "index.html", bytes: new TextEncoder().encode("hi") }] }, false);
  assert.deepEqual(made, { ok: true, value: { commit: "5".repeat(40) } });
  const created = seen.find((one) => one.path.endsWith("/git/refs") && one.method === "POST");
  assert.deepEqual(created?.body, { ref: "refs/heads/hq/site-builder-v2", sha: "5".repeat(40) });
  const commit = seen.find((one) => one.method === "POST" && one.path.endsWith("/git/commits"));
  assert.deepEqual((commit?.body as { parents: string[] }).parents, ["1".repeat(40)]);
  assert.ok(seen.every((one) => one.token === EVERYDAY));
  assert.deepEqual(await github.pullRequest(repo, { head: "hq/site-builder-v2", base: "production", title: "t", body: "b" }), { ok: true, value: { url: "https://github.com/c/s/pull/3", number: 3 } });
  // Onto an existing branch: moved, never forced.
  await github.commit(repo, { branch: "production", from: null, message: "v3", write: [] }, true);
  assert.deepEqual(seen.at(-1)?.body, { sha: "5".repeat(40), force: false });
  // A branch already there for this version is refused, not overwritten.
  assert.deepEqual(await github.commit(repo, { branch: "production", from: "production", message: "x", write: [] }, false), { ok: false, error: "repo-changed" });
});

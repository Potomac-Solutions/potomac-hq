import assert from "node:assert/strict";
import { test } from "node:test";
import { githubConfigFrom, githubPublisher } from "./github.ts";

const REPO = { owner: "Potomac-Solutions", name: "example-site", branch: "main" };
const TOKEN = "github_pat_test_0123456789abcdef";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** A stand-in for GitHub: answers each call from `answer`, and keeps what was asked. */
function fakeGithub(answer: (call: Call) => { status: number; body?: unknown; bytes?: Uint8Array }) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call: Call = { method: init.method ?? "GET", url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : undefined };
    calls.push(call);
    const made = answer(call);
    return new Response(made.bytes ? new Uint8Array(made.bytes) : JSON.stringify(made.body ?? {}), { status: made.status });
  }) as unknown as typeof fetch;
  return { calls, fn };
}

const API = "https://api.github.com/repos/Potomac-Solutions/example-site";
/** GitHub when everything works: a branch at `head1`, then blobs, a tree, a commit and the branch moved. */
function working(call: Call): { status: number; body?: unknown } {
  if (call.method === "GET" && call.url === `${API}/git/ref/heads/main`) return { status: 200, body: { object: { sha: "head1" } } };
  if (call.method === "GET" && call.url === `${API}/git/commits/head1`) return { status: 200, body: { tree: { sha: "tree1" } } };
  if (call.method === "POST" && call.url === `${API}/git/blobs`) return { status: 201, body: { sha: `blob-${(call.body as { content: string }).content.length}` } };
  if (call.method === "POST" && call.url === `${API}/git/trees`) return { status: 201, body: { sha: "tree2" } };
  if (call.method === "POST" && call.url === `${API}/git/commits`) return { status: 201, body: { sha: "commit2" } };
  if (call.method === "PATCH" && call.url === `${API}/git/refs/heads/main`) return { status: 200, body: { object: { sha: "commit2" } } };
  return { status: 500 };
}

test("a file is read raw from its branch, with the token and never anything else", async () => {
  const fake = fakeGithub(() => ({ status: 200, bytes: new Uint8Array([1, 2, 3]) }));
  const read = await githubPublisher({ token: TOKEN }, { fetch: fake.fn }).read({ ...REPO, branch: "feat/new look" }, "public/gallery/paint booth.webp");
  assert.deepEqual(read, { ok: true, value: new Uint8Array([1, 2, 3]) });
  const call = fake.calls[0];
  assert.ok(call);
  assert.equal(call.url, `${API}/contents/public/gallery/paint%20booth.webp?ref=feat%2Fnew%20look`);
  assert.equal(call.headers["authorization"], `Bearer ${TOKEN}`);
  assert.equal(call.headers["accept"], "application/vnd.github.raw+json");
});

test("a refusal says what kind it is, and never carries GitHub's words", async () => {
  for (const [status, error] of [[401, "repo-refused"], [403, "repo-refused"], [404, "repo-missing"], [500, "repo-failed"]] as const) {
    const fake = fakeGithub(() => ({ status, body: { message: `secret detail ${TOKEN}` } }));
    assert.deepEqual(await githubPublisher({ token: TOKEN }, { fetch: fake.fn }).read(REPO, "src/content/site.json"), { ok: false, error });
  }
  const down = (async () => {
    throw new Error("getaddrinfo ENOTFOUND api.github.com");
  }) as unknown as typeof fetch;
  assert.deepEqual(await githubPublisher({ token: TOKEN }, { fetch: down }).read(REPO, "x.json"), { ok: false, error: "repo-failed" });
});

test("a publish is one commit: blobs, a tree on the branch's tree with removals, a commit, and the branch moved without force", async () => {
  const fake = fakeGithub(working);
  const made = await githubPublisher({ token: TOKEN }, { fetch: fake.fn }).commit(REPO, {
    message: "Update site content",
    write: [
      { path: "src/content/site.json", bytes: new TextEncoder().encode('{"gallery":[]}') },
      { path: "public/gallery/hq-1.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff]) },
    ],
    remove: ["public/gallery/old.webp"],
  });
  assert.deepEqual(made, { ok: true, value: { commit: "commit2" } });
  assert.deepEqual(fake.calls.map((call) => `${call.method} ${call.url.replace(API, "")}`), ["GET /git/ref/heads/main", "GET /git/commits/head1", "POST /git/blobs", "POST /git/blobs", "POST /git/trees", "POST /git/commits", "PATCH /git/refs/heads/main"]);
  assert.deepEqual(fake.calls[2]?.body, { content: Buffer.from('{"gallery":[]}').toString("base64"), encoding: "base64" });
  assert.deepEqual(fake.calls[3]?.body, { content: "/9j/", encoding: "base64" });
  assert.deepEqual(fake.calls[4]?.body, {
    base_tree: "tree1",
    tree: [
      { path: "src/content/site.json", mode: "100644", type: "blob", sha: "blob-20" },
      { path: "public/gallery/hq-1.jpg", mode: "100644", type: "blob", sha: "blob-4" },
      { path: "public/gallery/old.webp", mode: "100644", type: "blob", sha: null },
    ],
  });
  assert.deepEqual(fake.calls[5]?.body, { message: "Update site content", tree: "tree2", parents: ["head1"] });
  assert.deepEqual(fake.calls[6]?.body, { sha: "commit2", force: false });
});

test("if the branch moved meanwhile, the publish is tried once more from the new head, then given up", async () => {
  let moves = 0;
  const once = fakeGithub((call) => (call.method === "PATCH" && moves++ === 0 ? { status: 422, body: { message: "Update is not a fast forward" } } : working(call)));
  assert.deepEqual(await githubPublisher({ token: TOKEN }, { fetch: once.fn }).commit(REPO, { message: "m", write: [], remove: [] }), { ok: true, value: { commit: "commit2" } });
  assert.equal(once.calls.filter((call) => call.method === "PATCH").length, 2);
  const always = fakeGithub((call) => (call.method === "PATCH" ? { status: 422 } : working(call)));
  assert.deepEqual(await githubPublisher({ token: TOKEN }, { fetch: always.fn }).commit(REPO, { message: "m", write: [], remove: [] }), { ok: false, error: "repo-changed" });
  assert.equal(always.calls.filter((call) => call.method === "PATCH").length, 2);
  const protectedBranch = fakeGithub((call) => (call.method === "PATCH" ? { status: 403 } : working(call)));
  assert.deepEqual(await githubPublisher({ token: TOKEN }, { fetch: protectedBranch.fn }).commit(REPO, { message: "m", write: [], remove: [] }), { ok: false, error: "repo-refused" });
});

test("the token comes from HQ_GITHUB_TOKEN; without it publishing is off", () => {
  assert.equal(githubConfigFrom({}), null);
  assert.equal(githubConfigFrom({ HQ_GITHUB_TOKEN: "  " }), null);
  assert.deepEqual(githubConfigFrom({ HQ_GITHUB_TOKEN: ` ${TOKEN} ` }), { token: TOKEN });
  assert.throws(() => githubConfigFrom({ HQ_GITHUB_TOKEN: "not a token!" }), /doesn't look like/);
});

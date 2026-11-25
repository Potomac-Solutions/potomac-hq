// Going live from the site builder (decision 0010, slice 4), with stand-ins
// for GitHub and Claude: a new private repository made with the version as
// its first commit and later versions committed onto it; or a pull request
// to a client's own repository, never onto its deploy branch.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Claude, ClaudeAnswer, SitePublishing } from "../../src/builder/index.ts";
import { idIn, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";
import { png } from "../support/png.ts";

type Call = { readonly what: string; readonly args: unknown[] };
const calls: Call[] = [];
const repos = new Set(["Potomac-Solutions/taken-site", "client-org/their-site"]);
const publishing: SitePublishing = {
  organization: "Potomac-Solutions",
  canCreate: true,
  async createRepo(name, description) {
    calls.push({ what: "createRepo", args: [name, description] });
    if (repos.has(`Potomac-Solutions/${name}`)) return { ok: false, error: "repo-exists" };
    repos.add(`Potomac-Solutions/${name}`);
    return { ok: true, value: { branch: "main" } };
  },
  async defaultBranch(repo, admin) {
    calls.push({ what: "defaultBranch", args: [repo, admin] });
    return repos.has(`${repo.owner}/${repo.name}`) ? { ok: true, value: "production" } : { ok: false, error: "repo-missing" };
  },
  async commit(repo, change, admin) {
    calls.push({ what: "commit", args: [repo, change, admin] });
    return { ok: true, value: { commit: "c".repeat(40) } };
  },
  async pullRequest(repo, request) {
    calls.push({ what: "pullRequest", args: [repo, request] });
    return { ok: true, value: { url: `https://github.com/${repo.owner}/${repo.name}/pull/7`, number: 7 } };
  },
};
const jobs: (() => Promise<void>)[] = [];
let answer: ClaudeAnswer = { ok: true, input: { summary: "First.", write: [{ path: "index.html", content: "<h1>Hi</h1>" }, { path: "content/site.json", content: '{"notice":"","gallery":[],"testimonials":[]}' }], remove: [] }, inputTokens: 100, outputTokens: 100 };
const claude: Claude = { ask: async () => answer };
const runJobs = async () => {
  while (jobs.length > 0) await jobs.shift()?.();
};

let t: TestApp;
let mikey: Client;
let manager: Client;
let clientId = "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
async function newBuild(name: string): Promise<string> {
  const res = await mikey.post("/builder", { organizationId: clientId, name, brief: "" });
  await runJobs();
  return idIn(res.headers.get("location") ?? "");
}
const last = (what: string) => [...calls].reverse().find((one) => one.what === what);

before(async () => {
  t = await testApp({ claude, builderPublishing: publishing, builderOwner: "mikey@example.com", runLater: (job) => void jobs.push(job) });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  manager = await signIn(t, "pat@example.com", "Pat", ["manager"]);
  clientId = idIn((await mikey.submit("/clients", { name: "Better Days Towing", sizeTier: "small", website: "", phone: "", address: "" })).location);
});
after(() => t.stop());

test("a new private repository gets the version as its first commit, pictures and all; later versions go onto it", async () => {
  const buildId = await newBuild("Better Days website");
  await mikey.upload(`/builder/${buildId}/images`, { kind: "logo", alt: "The logo" }, { field: "image", name: "logo.png", bytes: png(300, 100), type: "image/png" });
  assert.match(textOf(await mikey.page(`/builder/${buildId}`)), /A new private repository under Potomac-Solutions/);
  assert.match(await mikey.page(`/builder/${buildId}`), /value="better-days-towing-site"/);
  assert.equal(problemOf(await manager.post(`/builder/${buildId}/publish`, { target: "new", repoName: "x" })), "You don’t have permission to do that.");
  assert.equal(problemOf(await mikey.post(`/builder/${buildId}/publish`, { target: "new", repoName: "taken-site" })), "There’s already a repository with that name. Choose another.");
  assert.equal(problemOf(await mikey.post(`/builder/${buildId}/publish`, { target: "new", repoName: "bad name" })), "A repository name is letters, numbers, dashes, dots and underscores, like better-days-towing-site.");

  const res = await mikey.post(`/builder/${buildId}/publish`, { target: "new", repoName: "" });
  assert.equal(doneOf(res), "Published to Potomac-Solutions/better-days-towing-site, a new private repository. Set up website editing on the client’s page later.");
  const commit = last("commit");
  assert.ok(commit);
  const [repo, change, admin] = commit.args as [{ owner: string; name: string }, { branch: string; from: string | null; message: string; write: { path: string }[] }, boolean];
  assert.deepEqual(repo, { owner: "Potomac-Solutions", name: "better-days-towing-site" });
  assert.deepEqual([change.branch, change.from, admin], ["main", null, true]);
  assert.deepEqual(change.write.map((one) => one.path).sort(), ["content/site.json", "images/" + String(t.db.prepare("select path from build_image").get()?.["path"]).slice("images/".length), "index.html"].sort());
  assert.match(change.message, /^Better Days website: version 1\n\nFirst\./);
  assert.match(textOf(await mikey.page(`/builder/${buildId}`)), /Version 1 · New repository · Potomac-Solutions\/better-days-towing-site, main/);
  assert.equal(problemOf(await mikey.post(`/builder/${buildId}/publish`, {})), "This version has already been published. Ask Claude for a change, or restore a version, to publish again.");

  answer = { ok: true, input: { summary: "Second.", write: [{ path: "index.html", content: "<h1>Two</h1>" }], remove: [] }, inputTokens: 100, outputTokens: 100 };
  await mikey.post(`/builder/${buildId}/ask`, { ask: "Again." });
  await runJobs();
  assert.equal(doneOf(await mikey.post(`/builder/${buildId}/publish`, { target: "existing", repo: "ignored/once-published" })), "Published to Potomac-Solutions/better-days-towing-site. Its host rebuilds it in a minute or two.");
  const second = last("commit")?.args as [unknown, { branch: string; from: string | null }, boolean];
  assert.deepEqual([second[1].branch, second[1].from, second[2]], ["main", null, true]);
  assert.equal(calls.filter((one) => one.what === "createRepo").length, 2, "no second repository");
});

test("a client's own repository gets a branch per version and a pull request into its deploy branch", async () => {
  const buildId = await newBuild("Their redesign");
  assert.equal(problemOf(await mikey.post(`/builder/${buildId}/publish`, { target: "existing", repo: "client-org/missing" })), "GitHub has no such repository or branch, or HQ’s token can’t see it.");
  const res = await mikey.post(`/builder/${buildId}/publish`, { target: "existing", repo: "client-org/their-site", branch: "" });
  assert.equal(doneOf(res), "Published as a pull request to client-org/their-site. Check and merge it on GitHub.");
  const [, change, admin] = last("commit")?.args as [unknown, { branch: string; from: string }, boolean];
  assert.deepEqual([change.branch, change.from, admin], ["hq/site-builder-v1", "production", false]);
  const [, request] = last("pullRequest")?.args as [unknown, { head: string; base: string; title: string }];
  assert.deepEqual([request.head, request.base, request.title], ["hq/site-builder-v1", "production", "Their redesign: version 1"]);
  const page = await mikey.page(`/builder/${buildId}`);
  assert.match(textOf(page), /Version 1 · Pull request · client-org\/their-site, into production/);
  assert.match(textOf(page), /goes to a pull request to client-org\/their-site, into production, the same way as before/);
  assert.match(page, /href="https:\/\/github\.com\/client-org\/their-site\/pull\/7"/);
  assert.ok(t.db.prepare("select count(*) as n from activity_event where action = 'build.published'").get()?.["n"]);
});

test("without GitHub, versions can only be downloaded", async () => {
  const bare = await testApp({ claude, runLater: (job) => void jobs.push(job) });
  try {
    const admin = await signIn(bare, "mikey@example.com", "Mikey Nichols", ["admin"]);
    const client = idIn((await admin.submit("/clients", { name: "Nu Finish", sizeTier: "small", website: "", phone: "", address: "" })).location);
    const res = await admin.post("/builder", { organizationId: client, name: "Nu Finish site", brief: "" });
    await runJobs();
    const buildId = idIn(res.headers.get("location") ?? "");
    assert.match(textOf(await admin.page(`/builder/${buildId}`)), /versions can only be downloaded/);
    const refused = await admin.post(`/builder/${buildId}/publish`, { target: "new" });
    assert.equal(new URL(bare.origin + (refused.headers.get("location") ?? "")).searchParams.get("problem"), "HQ has no GitHub token, so versions can only be downloaded. Set HQ_GITHUB_ADMIN_TOKEN or HQ_GITHUB_TOKEN on the server.");
  } finally {
    await bare.stop();
  }
});

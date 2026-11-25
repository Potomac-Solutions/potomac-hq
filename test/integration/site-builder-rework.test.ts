// Reworking a site that already exists (decision 0010, slice 3), over real
// HTTP with stand-ins for GitHub, the web and Claude: a static repository
// becomes version 1 as it was, a project and a live site are read as
// reference for Claude, pictures keep their paths, and nothing is kept when
// the old site can't be read.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import type { Claude, ClaudeAnswer, ClaudeCall, RepoReader } from "../../src/builder/index.ts";
import { count, idIn, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";
import { png } from "../support/png.ts";

const enc = (text: string) => new TextEncoder().encode(text);
const REPOS: Record<string, Record<string, Uint8Array>> = {
  "Potomac-Solutions/plain-site": {
    "index.html": enc('<!doctype html><html lang="en"><body><h1>Gormania Feed</h1><img src="img/barn.png" alt=""></body></html>'),
    "css/site.css": enc("h1 { color: green; }"),
    "img/barn.png": png(1200, 800),
  },
  "Potomac-Solutions/better-days-towing": {
    "package.json": enc('{"name":"bdt"}'),
    "README.md": enc("# Better Days Towing\n24-hour towing in Western Maryland."),
    "src/App.jsx": enc("export const App = () => <h1>Better Days Towing</h1>;"),
    "public/logo.png": png(600, 200),
  },
};
const sha = (repo: string, path: string) => createHash("sha1").update(`${repo}:${path}`).digest("hex");
const repos: RepoReader = {
  async tree(repo) {
    const files = REPOS[`${repo.owner}/${repo.name}`];
    if (!files) return { ok: false, error: "repo-missing" };
    return { ok: true, value: { branch: repo.branch ?? "main", files: Object.entries(files).map(([path, bytes]) => ({ path, size: bytes.length, sha: sha(`${repo.owner}/${repo.name}`, path) })) } };
  },
  async blob(repo, wanted) {
    const files = REPOS[`${repo.owner}/${repo.name}`] ?? {};
    const found = Object.entries(files).find(([path]) => sha(`${repo.owner}/${repo.name}`, path) === wanted);
    return found ? { ok: true, value: found[1] } : { ok: false, error: "repo-missing" };
  },
};
const PAGES: Record<string, string> = {
  "https://towing.example/": '<!doctype html><html><body><h1>Better Days</h1><a href="/rates">Rates</a><a href="https://elsewhere.example/">x</a><script>track()</script></body></html>',
  "https://towing.example/rates": "<!doctype html><html><body><h2>Rates</h2><p>$95 hookup</p></body></html>",
};
const fetched: string[] = [];
const outsideFetch = async (url: string) => {
  fetched.push(url);
  if (url.includes("10.0.0.1")) return { ok: false as const, error: "address-private" as const };
  const text = PAGES[url];
  return text ? { ok: true as const, value: { status: 200, text } } : { ok: true as const, value: { status: 404, text: "" } };
};

let t: TestApp;
let mikey: Client;
let clientId = "";
const calls: ClaudeCall[] = [];
const jobs: (() => Promise<void>)[] = [];
const next: ClaudeAnswer = { ok: true, input: { summary: "Reworked it.", write: [{ path: "index.html", content: "<!doctype html><title>New</title><h1>New</h1>" }], remove: [] }, inputTokens: 1_000, outputTokens: 1_000 };
const claude: Claude = {
  async ask(call) {
    calls.push(call);
    return next;
  },
};
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const rework = (fields: Record<string, string>) => mikey.post("/builder/rework", { organizationId: clientId, name: "Redesign", brief: "Make it modern.", source: "repo", repo: "", branch: "", address: "", ...fields });
const runJobs = async () => {
  while (jobs.length > 0) await jobs.shift()?.();
};

before(async () => {
  t = await testApp({ claude, builderRepos: repos, outsideFetch, builderOwner: "mikey@example.com", runLater: (job) => void jobs.push(job) });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  clientId = idIn((await mikey.submit("/clients", { name: "Better Days Towing", sizeTier: "small", website: "", phone: "", address: "" })).location);
});
after(() => t.stop());

test("a plain static repository becomes version 1 as it was, its pictures at their old paths", async () => {
  const res = await rework({ repo: "Potomac-Solutions/plain-site" });
  assert.equal(doneOf(res), "Read 2 files, kept as version 1 and 1 picture. Claude is reworking it now. This page updates when it’s ready.");
  const buildId = idIn(res.headers.get("location") ?? "");
  const page = textOf(await mikey.page(`/builder/${buildId}`));
  assert.match(page, /reworked from github\.com\/Potomac-Solutions\/plain-site/);
  assert.match(page, /Imported as it was from github\.com\/Potomac-Solutions\/plain-site\./);
  const src = /<iframe[^>]+src="([^"]+)"/.exec(await mikey.page(`/builder/${buildId}`))?.[1] ?? "";
  assert.match(await (await fetch(t.origin + src)).text(), /Gormania Feed/);
  const barn = await fetch(`${t.origin}${src}img/barn.png`);
  assert.equal(barn.headers.get("content-type"), "image/png");
  await runJobs();
  const call = calls.at(-1);
  assert.ok(call);
  assert.match(call.message, /<file path="css\/site.css">/);
  assert.doesNotMatch(call.message, /<old_site/, "a version exists, so no reference");
  assert.match(call.message, /img\/barn\.png \| photo \| 1200x800 \| shows: From the old site: barn/);
});

test("a project is read as reference for the first request, and its logo kept", async () => {
  const res = await rework({ repo: "https://github.com/Potomac-Solutions/better-days-towing", branch: "main" });
  assert.match(doneOf(res), /^Read 3 files and 1 picture\. Claude is reworking it now/);
  await runJobs();
  const call = calls.at(-1);
  assert.ok(call);
  assert.match(call.message, /<old_site from="github\.com\/Potomac-Solutions\/better-days-towing \(main\)">/);
  assert.match(call.message, /<source from="README.md">\n# Better Days Towing/);
  assert.match(call.message, /export const App/);
  assert.match(call.message, /public\/logo\.png \| logo \| 600x200/);
  assert.match(call.message, /This is the first version/);
  // Once Claude has made a version, the old site stops going with requests.
  const buildId = idIn(res.headers.get("location") ?? "");
  await mikey.post(`/builder/${buildId}/ask`, { ask: "Darker." });
  await runJobs();
  assert.doesNotMatch(calls.at(-1)?.message ?? "", /<old_site/);
});

test("a live site is read from its address: the home page and its same-site links, slimmed", async () => {
  const res = await rework({ source: "address", address: "towing.example" });
  assert.match(doneOf(res), /^Read 2 pages\. Claude is reworking it now/);
  await runJobs();
  const message = calls.at(-1)?.message ?? "";
  assert.match(message, /<old_site from="towing\.example">/);
  assert.match(message, /\$95 hookup/);
  assert.doesNotMatch(message, /track\(\)/);
  assert.deepEqual(fetched.slice(-2), ["https://towing.example/", "https://towing.example/rates"], "only same-site pages are read");
});

test("an old site that can't be read leaves nothing behind", async () => {
  const before = count(t.db, "build");
  assert.equal(problemOf(await rework({ repo: "Potomac-Solutions/nope" })), "GitHub has no such repository or branch, or HQ’s token can’t see it.");
  assert.equal(problemOf(await rework({ repo: "not a repo" })), "Enter the repository as owner/name, like Potomac-Solutions/better-days-towing.");
  assert.equal(problemOf(await rework({ source: "address", address: "https://10.0.0.1/" })), "That address is inside a private network, so HQ won’t read it.");
  assert.equal(problemOf(await rework({ source: "address", address: "towing.example/missing" })), "HQ couldn’t read a web page at that address. Check it opens in a browser.");
  assert.equal(count(t.db, "build"), before);
});

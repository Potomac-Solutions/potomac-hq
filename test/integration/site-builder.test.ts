// The site builder over real HTTP (decision 0010), with a stand-in for
// Claude: admins start a build and ask for changes, each answer becomes a
// version shown in a sandboxed preview, the monthly cap is never crossed,
// and only the owner changes the model and the cap.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { failLostRequests, type Claude, type ClaudeAnswer, type ClaudeCall } from "../../src/builder/index.ts";
import { actions, events, idIn, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let jayanti: Client;
let manager: Client;
let clientId = "";
let buildId = "";
const calls: ClaudeCall[] = [];
const jobs: (() => Promise<void>)[] = [];
let next: ClaudeAnswer = { ok: false, error: "failed", inputTokens: 0, outputTokens: 0 };
const claude: Claude = {
  async ask(call) {
    calls.push(call);
    return next;
  },
};
const answer = (input: unknown, output = 2_000): ClaudeAnswer => ({ ok: true, input, inputTokens: 5_000, outputTokens: output });
const runJobs = async () => {
  while (jobs.length > 0) await jobs.shift()?.();
};
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const previewSrc = (html: string) => /<iframe[^>]+src="([^"]+)"/.exec(html)?.[1]?.replaceAll("&amp;", "&") ?? "";

const SITE = {
  summary: "Made a home page with the phone number up top.",
  write: [
    { path: "index.html", content: '<!doctype html><html lang="en"><head><link rel="stylesheet" href="styles/site.css"><title>Better Days Towing</title></head><body><h1>Better Days Towing</h1></body></html>' },
    { path: "styles/site.css", content: "body { font-family: system-ui; }" },
  ],
  remove: [],
};

before(async () => {
  t = await testApp({ claude, builderOwner: "mikey@example.com", runLater: (job) => void jobs.push(job) });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  jayanti = await signIn(t, "jayanti@example.com", "Jayanti Nichols", ["admin"]);
  manager = await signIn(t, "pat@example.com", "Pat", ["manager"]);
  const made = await mikey.submit("/clients", { name: "Better Days Towing", sizeTier: "small", website: "", phone: "301-555-0100", address: "" });
  clientId = idIn(made.location);
});
after(() => t.stop());

test("only admins see the site builder", async () => {
  assert.match(textOf(await mikey.page("/builder")), /Start a build/);
  assert.match(textOf(await mikey.page("/")), /Site builder/);
  assert.doesNotMatch(textOf(await manager.page("/builder")), /Start a build/);
  assert.doesNotMatch(textOf(await manager.page("/")), /Site builder/);
  assert.equal(problemOf(await manager.post("/builder", { organizationId: clientId, name: "x", brief: "" })), "You don’t have permission to do that.");
});

test("starting a build asks Claude for the first version, with the client's facts and the brief", async () => {
  next = answer(SITE);
  assert.equal(problemOf(await mikey.post("/builder", { organizationId: "", name: "Site", brief: "" })), "Choose a client for the site.");
  const res = await mikey.post("/builder", { organizationId: clientId, name: "Better Days website", brief: "Towing across Western Maryland, 24 hours." });
  assert.equal(doneOf(res), "Started. Claude is making the first version. This page updates when it’s ready.");
  buildId = idIn(res.headers.get("location") ?? "");
  assert.match(textOf(await mikey.page(`/builder/${buildId}`)), /Claude is making the first version/);
  await runJobs();
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.model, "claude-opus-5-5");
  assert.deepEqual(call.tool.name, "save_site");
  assert.match(call.message, /Business name: Better Days Towing/);
  assert.match(call.message, /Business phone: 301-555-0100/);
  assert.match(call.message, /Towing across Western Maryland, 24 hours\./);
  assert.match(call.message, /This is the first version/);
  const page = await mikey.page(`/builder/${buildId}`);
  assert.match(textOf(page), /Version 1, the newest/);
  assert.match(textOf(page), /Made a home page with the phone number up top\./);
  assert.match(page, /sandbox="allow-scripts"/);
  assert.ok(actions(t.db).includes("build.started"));
  assert.ok(actions(t.db).includes("build.version-made"));
});

test("the preview is served sandboxed, by its token alone, and nothing outside the version", async () => {
  const src = previewSrc(await mikey.page(`/builder/${buildId}`));
  assert.match(src, /^\/builder\/preview\/[^/]+\/$/);
  // No cookies: the sandboxed frame sends none.
  const home = await fetch(t.origin + src);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts;/);
  assert.equal(home.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(await home.text(), /<h1>Better Days Towing<\/h1>/);
  const css = await fetch(`${t.origin}${src}styles/site.css`);
  assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal((await fetch(`${t.origin}${src}nope.html`)).status, 404);
  assert.equal((await fetch(`${t.origin}${src}..%2F..%2Fhealthz`)).status, 404);
  const forged = src.replace(/\.[A-Za-z0-9_-]{43}\/$/, `.${"A".repeat(43)}/`);
  assert.equal((await fetch(t.origin + forged)).status, 404);
  // HQ's own pages may frame it; nothing else.
  assert.match((await mikey.get(`/builder/${buildId}`)).headers.get("content-security-policy") ?? "", /frame-src 'self'/);
});

test("a change becomes the next version; an unsound answer is refused whole but still counted", async () => {
  next = answer({ summary: "Darker hero.", write: [{ path: "styles/site.css", content: "body { background: #111; color: #fff; }" }], remove: [] });
  assert.equal(problemOf(await mikey.post(`/builder/${buildId}/ask`, { ask: " " })), "Say what Claude should do.");
  assert.equal(doneOf(await jayanti.post(`/builder/${buildId}/ask`, { ask: "Make the hero darker." })), "Sent. Claude is working on it. This page updates when it’s ready.");
  // One request at a time on a build.
  assert.equal(problemOf(await mikey.post(`/builder/${buildId}/ask`, { ask: "And bigger." })), "Claude is still working on this site. Wait for that answer first.");
  await runJobs();
  assert.match(calls.at(-1)?.message ?? "", /<file path="styles\/site.css">/);
  assert.match(calls.at(-1)?.message ?? "", /Asked: Make the first version/);
  assert.match(textOf(await mikey.page(`/builder/${buildId}`)), /Version 2, the newest/);

  next = answer({ summary: "Oops.", write: [{ path: "../escape.html", content: "x" }], remove: [] });
  await mikey.post(`/builder/${buildId}/ask`, { ask: "Add a page." });
  await runJobs();
  const failed = t.db.prepare("select state, error, cost_micros from build_request order by created_at desc limit 1").get();
  assert.deepEqual([failed?.["state"], failed?.["error"]], ["failed", "path-invalid"]);
  assert.ok(Number(failed?.["cost_micros"]) > 0);
  assert.match(textOf(await mikey.page(`/builder/${buildId}`)), /a file with a name HQ doesn’t allow/);
  assert.equal(t.db.prepare("select count(*) as n from build_version where build_id = ?").get(buildId)?.["n"], 2);
});

test("an older version can be shown, downloaded and restored as the newest", async () => {
  assert.match(textOf(await mikey.page(`/builder/${buildId}?v=1`)), /Version 1/);
  assert.equal((await mikey.get(`/builder/${buildId}?v=9`)).status, 404);
  const zip = await mikey.get(`/builder/${buildId}/versions/1/site.zip`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get("content-type"), "application/zip");
  assert.match(zip.headers.get("content-disposition") ?? "", /better-days-website-v1\.zip/);
  assert.match(new TextDecoder().decode(await zip.arrayBuffer()), /better-days-website\/index\.html/);
  assert.equal((await manager.get(`/builder/${buildId}/versions/1/site.zip`)).status, 404);
  assert.equal(doneOf(await mikey.post(`/builder/${buildId}/restore`, { version: "1" })), "Restored as the newest version.");
  assert.match(textOf(await mikey.page(`/builder/${buildId}`)), /Version 3, the newest/);
  assert.equal(problemOf(await mikey.post(`/builder/${buildId}/restore`, { version: "3" })), "That is already the newest version.");
  assert.ok(actions(t.db).includes("build.restored"));
});

test("only the owner changes the model and the cap", async () => {
  assert.match(textOf(await jayanti.page("/builder/settings")), /Only the owner can change these/);
  assert.equal(problemOf(await jayanti.post("/builder/settings", { model: "claude-haiku-5-5", cap: "50" })), "You don’t have permission to do that.");
  assert.equal(problemOf(await mikey.post("/builder/settings", { model: "gpt-5", cap: "10" })), "Choose one of the models listed.");
  assert.equal(problemOf(await mikey.post("/builder/settings", { model: "claude-opus-5-5", cap: "0.50" })), "Enter the cap in dollars, from $1 to $1,000, like 10 or 12.50.");
  assert.equal(doneOf(await mikey.post("/builder/settings", { model: "claude-sonnet-5-5", cap: "12.50" })), "Saved.");
  assert.deepEqual({ ...t.db.prepare("select model, cap_cents from builder_settings").get() }, { model: "claude-sonnet-5-5", cap_cents: 1250 });
  const page = textOf(await mikey.page("/builder/settings"));
  assert.match(page, /Jayanti Nichols/);
  assert.match(page, /Better Days website/);
  assert.ok(events(t.db).some((one) => one.action === "builder.settings-changed" && one.context["capCents"] === 1250));
});

test("a request whose worst case would pass the cap is never sent", async () => {
  await mikey.post("/builder/settings", { model: "claude-opus-5-5", cap: "1" });
  // A big answer: 30,000 output tokens on Opus is $0.60 on its own.
  next = answer(SITE, 30_000);
  await mikey.post(`/builder/${buildId}/ask`, { ask: "Rewrite everything." });
  await runJobs();
  const before = calls.length;
  const refused = await mikey.post(`/builder/${buildId}/ask`, { ask: "One more." });
  assert.equal(problemOf(refused), "That could pass this month’s cap, so it wasn’t sent. Ask for something smaller, or the owner can raise the cap.");
  assert.equal(calls.length, before, "Claude was not asked");
  const spent = t.db.prepare("select sum(cost_micros) as micros from build_request").get()?.["micros"];
  assert.ok(Number(spent) <= 1_000_000);
});

test("a request lost when HQ restarted is failed and counted at what it reserved", async () => {
  await mikey.post("/builder/settings", { model: "claude-opus-5-5", cap: "50" });
  next = answer(SITE);
  await mikey.post(`/builder/${buildId}/ask`, { ask: "Lost one." });
  jobs.length = 0; // HQ "restarted" before the answer came back.
  t.db.prepare("update build_request set created_at = '2020-01-01T00:00:00Z' where state = 'working'").run();
  assert.equal(failLostRequests(t.services.builder), 1);
  const row = t.db.prepare("select state, error, cost_micros, reserved_micros from build_request where ask = 'Lost one.'").get();
  assert.deepEqual([row?.["state"], row?.["error"], row?.["cost_micros"]], ["failed", "lost", row?.["reserved_micros"]]);
  assert.doesNotMatch(textOf(await mikey.page(`/builder/${buildId}`)), /Claude is working on it/);
});

test("without a key the builder can be seen but Claude isn't asked", async () => {
  const bare = await testApp();
  try {
    const admin = await signIn(bare, "mikey@example.com", "Mikey Nichols", ["admin"]);
    const made = await admin.submit("/clients", { name: "Nu Finish", sizeTier: "small", website: "", phone: "", address: "" });
    assert.match(textOf(await admin.page("/builder")), /HQ has no Claude API key/);
    const res = await admin.post("/builder", { organizationId: idIn(made.location), name: "Nu Finish site", brief: "" });
    assert.equal(doneOf(res), "Started, but Claude wasn’t asked yet. HQ has no Claude API key, so it can’t ask Claude. Set HQ_ANTHROPIC_API_KEY on the server.");
  } finally {
    await bare.stop();
  }
});

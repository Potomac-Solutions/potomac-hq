// Webhooks (decision 0007, section 12) against a real database and over real
// HTTP. Sending is a stand-in that records what would go out.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { addTaskComment } from "../../src/projects/index.ts";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import * as webhooks from "../../src/webhooks/index.ts";
import { httpsHookSend, webhookSigner } from "../../src/webhooks/adapters.ts";
import { signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

const KEY = "test-secret-test-secret-test-secret-00";
let t: TestApp;
let mikey: Client;
let manager: Client;
let mikeyId: Id;
let hookId: Id;
let secret = "";
let website: Id;
type Sent = { url: string; body: string; headers: Readonly<Record<string, string>> };
const sent: Sent[] = [];
let answer: { status: number; answer: string } | { error: string } = { status: 200, answer: "ok" };
const send: webhooks.HookSend = async (url, body, headers) => (sent.push({ url, body, headers }), answer);
const deliveries = () => t.db.prepare("select event, state, attempts, next_at, payload from webhook_delivery order by created_at, rowid").all() as { event: string; state: string; attempts: number; next_at: string | null; payload: string }[];
const queued = () => deliveries().filter((one) => one.state === "pending").map((one) => one.event);
// The app signs with HQ's key; the test's own services are given the same signer.
const run = (now?: string) => webhooks.deliverDue({ ...t.services.webhooks, signer: webhookSigner(KEY), ...(now ? { clock: () => now } : {}) }, send);
const secretIn = (html: string) => /<input readonly value="([^"]+)">/.exec(html)?.[1] ?? "";

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  manager = await signIn(t, "jay@example.com", "Jayanti Nichols", ["manager"]);
  await mikey.get("/");
  await manager.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("admins only; the secret is shown once and never stored", async () => {
  assert.doesNotMatch(await manager.page("/today"), /href="\/webhooks"/);
  assert.equal((await manager.get("/webhooks")).status, 403);
  assert.equal((await manager.post("/webhooks", { url: "https://n8n.example.com/webhook/hq", "event-task.done": "1" })).status, 303);
  assert.equal(t.db.prepare("select count(*) as n from webhook").get()?.["n"], 0);

  const bad = await mikey.post("/webhooks", { url: "https://localhost/hook", "event-task.done": "1" });
  assert.match(new URL("http://x" + (bad.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /inside a network/);

  const res = await mikey.post("/webhooks", { url: "https://n8n.example.com/webhook/hq", "event-task.added": "1", "event-task.assigned": "1", "event-task.done": "1", "event-task.moved": "1", "event-task.commented": "1", "event-project.added": "1", "event-project.completed": "1" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const html = await res.text();
  assert.match(html, /<h1>Webhook added<\/h1>/);
  assert.match(html, /X-HQ-Signature-256/);
  secret = secretIn(html);
  hookId = t.db.prepare("select id from webhook").get()?.["id"] as Id;
  const salt = t.db.prepare("select salt from webhook").get()?.["salt"] as string;
  assert.equal(secret, webhookSigner(KEY).secretFor({ id: hookId, salt }));
  assert.doesNotMatch(JSON.stringify(t.db.prepare("select * from webhook").all()), new RegExp(secret), "not stored");
  assert.match(textOf(await mikey.page("/webhooks")), /https:\/\/n8n\.example\.com\/webhook\/hq .*Nothing sent yet/);
  assert.match(await mikey.page("/today"), /href="\/webhooks"/);
});

test("what happens queues a delivery for each event it's sent, with the task or project as it is", async () => {
  website = (await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" })).project.id;
  assert.deepEqual(queued(), ["project.added"]);
  const task = unwrap(projects.addTask(t.services.projects, mikeyId, website, { title: "Send the proof", assigneeId: mikeyId, dueOn: "2026-12-01" }));
  unwrap(projects.moveTaskStatus(t.services.projects, mikeyId, task.id, "done"));
  unwrap(addTaskComment(t.services.projects, mikeyId, task.id, "Sent to Dale."));
  unwrap(projects.setProjectStatus(t.services.projects, mikeyId, website, "completed"));
  assert.deepEqual(queued(), ["project.added", "task.added", "task.assigned", "task.moved", "task.done", "task.commented", "project.completed"]);
  const done = JSON.parse(deliveries().find((one) => one.event === "task.done")?.payload ?? "{}");
  assert.equal(done.event, "task.done");
  assert.equal(done.by.name, "Mikey Nichols");
  assert.deepEqual({ title: done.task.title, status: done.task.status, due: done.task.dueOn, project: done.task.project.name, client: done.task.project.client, who: done.task.assignee.name }, { title: "Send the proof", status: "done", due: "2026-12-01", project: "Better Days website", client: "Better Days Towing", who: "Mikey Nichols" });
  assert.match(done.task.url, /\/tasks\/[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(deliveries().find((one) => one.event === "task.commented")?.payload ?? "{}").comment, "Sent to Dale.");
  assert.equal(JSON.parse(deliveries().find((one) => one.event === "task.moved")?.payload ?? "{}").to, "done");
});

test("each delivery is signed and delivered once it's answered with a 2xx", async () => {
  const result = await run();
  assert.deepEqual(result, { delivered: 7, failed: 0 });
  const first = sent[0];
  assert.ok(first);
  assert.equal(first.url, "https://n8n.example.com/webhook/hq");
  assert.equal(first.headers["x-hq-signature-256"], `sha256=${createHmac("sha256", secret).update(first.body).digest("hex")}`);
  assert.equal(first.headers["x-hq-event"], "project.added");
  assert.equal(first.headers["x-hq-delivery"], JSON.parse(first.body).id);
  assert.equal(first.headers["content-type"], "application/json");
  assert.deepEqual(queued(), []);
  assert.deepEqual(await run(), { delivered: 0, failed: 0 }, "nothing twice");
  assert.match(textOf(await mikey.page(`/webhooks/${hookId}`)), /Deliveries .*task\.done Delivered 1 200: ok/);
});

test("one that doesn't land is tried again, waiting longer, and given up on after a day", async () => {
  await mikey.submit(`/webhooks/${hookId}/test`, {});
  answer = { status: 500, answer: "n8n is down" };
  const start = new Date().toISOString();
  assert.deepEqual(await run(), { delivered: 0, failed: 1 });
  const after1 = deliveries().find((one) => one.event === "webhook.test");
  assert.equal(after1?.state, "pending");
  assert.equal(after1?.attempts, 1);
  assert.deepEqual(await run(), { delivered: 0, failed: 0 }, "not before its time");
  let now = Temporal.Instant.from(start);
  for (let tries = 2; tries <= 8; tries += 1) {
    now = now.add({ hours: 13 });
    await run(now.toString());
  }
  const last = deliveries().find((one) => one.event === "webhook.test");
  assert.equal(last?.state, "failed");
  assert.equal(last?.next_at, null);
  assert.match(textOf(await mikey.page(`/webhooks/${hookId}`)), /webhook\.test Gave up \d 500: n8n is down/);

  answer = { error: "No answer (ECONNREFUSED)" };
  await mikey.submit(`/webhooks/${hookId}/test`, {});
  await run();
  assert.match(textOf(await mikey.page(`/webhooks/${hookId}`)), /Waiting to try again Next: .* 1 No answer: No answer \(ECONNREFUSED\)/);
  answer = { status: 200, answer: "ok" };
});

test("paused, nothing is queued; a new secret is shown once and used at once; deleting takes its deliveries", async () => {
  await mikey.submit(`/webhooks/${hookId}/pause`, { paused: "1" });
  const before = deliveries().length;
  const open = (await wonProject(t.services, mikeyId, { client: "Undated Diner", title: "Diner menu" })).project.id;
  unwrap(projects.addTask(t.services.projects, mikeyId, open, { title: "Too late" }));
  assert.equal(deliveries().length, before, "paused");
  await mikey.submit(`/webhooks/${hookId}/pause`, { paused: "0" });

  const res = await mikey.post(`/webhooks/${hookId}/secret`, {});
  const html = await res.text();
  assert.match(html, /The old secret is no longer used/);
  const fresh = secretIn(html);
  assert.notEqual(fresh, secret);
  await mikey.submit(`/webhooks/${hookId}/test`, {});
  sent.length = 0;
  await run(new Date(Date.now() + 2 * 86_400_000).toISOString());
  const test = sent.find((one) => one.headers["x-hq-event"] === "webhook.test");
  assert.equal(test?.headers["x-hq-signature-256"], `sha256=${createHmac("sha256", fresh).update(test?.body ?? "").digest("hex")}`);

  const gone = await mikey.submit(`/webhooks/${hookId}/remove`, {});
  assert.match(gone.html, /Webhook deleted, with its deliveries\./);
  assert.equal(t.db.prepare("select count(*) as n from webhook_delivery").get()?.["n"], 0);
});

test("only the newest 200 are kept", async () => {
  const made = unwrap(webhooks.addWebhook({ ...t.services.webhooks, signer: webhookSigner(KEY) }, mikeyId, { url: "https://n8n.example.com/webhook/many", events: ["task.added"] }));
  const other = (await wonProject(t.services, mikeyId, { client: "Tailgate Farms", title: "Tailgate shop" })).project.id;
  for (let n = 0; n < 205; n += 1) unwrap(projects.addTask(t.services.projects, mikeyId, other, { title: `Task ${n}` }));
  assert.equal(t.db.prepare("select count(*) as n from webhook_delivery where webhook_id = ?").get(made.webhook.id)?.["n"], 200);
  assert.match(t.db.prepare("select payload from webhook_delivery where webhook_id = ? order by created_at desc, rowid desc").get(made.webhook.id)?.["payload"] as string, /Task 204/);
});

test("sending refuses addresses inside a network, plain http and other ports, before connecting", async () => {
  for (const url of ["https://127.0.0.1/hook", "https://10.0.0.5/hook", "https://[::1]/hook", "http://n8n.example.com/hook", "https://n8n.example.com:8443/hook"]) {
    const result = await httpsHookSend(url, "{}", {});
    assert.ok("error" in result, url);
  }
});

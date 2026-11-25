// Quality of life (Mikey, 2026-11-25) over real HTTP: System status, what
// changed on a record, and when notices are emailed.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as notices from "../../src/notices/index.ts";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
const sent: { to: string; subject: string }[] = [];
const userId = (email: string) => t.db.prepare("select id from user where email = ?").get(email)?.["id"] as Id;
const query = (res: Response, name: string) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get(name) ?? "";

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, backups: true, email: { publicUrl: "https://hq.example", send: async (message) => (message.to.includes("fail") ? { error: "brevo-http-401" } : (sent.push({ to: message.to, subject: message.subject }), { ok: true })) } });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
});
after(() => t.stop());

test("System status: what HQ depends on, for admins only", async () => {
  const page = textOf(await admin.page("/status"));
  assert.match(page, /System status/);
  assert.match(page, /Backups Set up, but none has run yet\. The first runs tonight\. Needs a look/);
  assert.match(page, /Email Set up\. Nothing sent since HQ started\. Working/);
  assert.match(page, /AI No API key/);
  assert.match(page, /Version 0\.\d+\.\d+/);
  assert.match(page, /Migrations \d+, the newest \d{4}-/);
  assert.equal((await member.get("/status")).status, 403);
  assert.match(textOf(await admin.page("/search?q=backups")), /Pages System status/);
});

test("What changed here: a record's own events, newest first", async () => {
  const mikey = userId("mikey@example.com");
  const { client, opportunity } = await wonProject(t.services, mikey, { client: "Nu-Finish Collision" });
  const page = textOf(await admin.page(`/clients/${client.id}`));
  assert.match(page, /What changed here \d+ changes?/);
  assert.match(page, /Mikey Nichols added a client/i);
  assert.match(textOf(await admin.page(`/opportunities/${opportunity.id}`)), /What changed here/);
});

test("notice settings: right away, the morning digest, never, and quiet hours", async () => {
  const sam = userId("sam@example.com");
  const mikey = userId("mikey@example.com");
  const { project } = await wonProject(t.services, mikey, { client: "Better Days Towing" });
  await member.post("/notices/email", { on: "1" });
  assert.match(textOf(await member.page("/notices")), /What's emailed, and when/);
  assert.match(query(await member.post("/notices/preferences", { assigned: "daily", mentioned: "now", reminder: "never", quietFrom: "21", quietTo: "" }), "problem"), /quiet hours/);
  assert.match(query(await member.post("/notices/preferences", { assigned: "daily", mentioned: "now", reminder: "never", quietFrom: "21", quietTo: "7" }), "done"), /Saved/);
  assert.match(textOf(await member.page("/notices")), /Quiet from 9 PM to 7 AM/);

  unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Fix the map", assigneeId: sam }));
  const mail = async (message: { to: string; subject: string; body: string }) => (sent.push(message), true);
  const at = (instant: string) => ({ ...t.services.notices, clock: () => instant });
  sent.length = 0;
  assert.deepEqual(await notices.emailNotices(at("2026-11-25T19:00:00Z"), mail, { publicUrl: "https://hq.example" }), { sent: 0, failed: 0 }, "2 PM: an assignment waits for the digest");
  assert.deepEqual(await notices.emailNotices(at("2026-11-26T12:00:00Z"), mail, { publicUrl: "https://hq.example" }), { sent: 1, failed: 0 }, "7 AM: the digest");
  assert.match(sent[0]?.subject ?? "", /Fix the map/);
  assert.match(textOf(await member.page("/notices")), /gave you “Fix the map”/, "the bell has it either way");
});

test("many at once: tasks moved, given, dated and labelled together; drafts marked sent together", async () => {
  const mikey = userId("mikey@example.com");
  const sam = userId("sam@example.com");
  const { project } = await wonProject(t.services, mikey, { client: "Garrett County Adventures" });
  const a = unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Kayak page" }));
  const b = unwrap(projects.addTask(t.services.projects, mikey, project.id, { title: "Rental form" }));
  const table = await admin.page("/work");
  assert.match(table, new RegExp(`name="task-${a.id}"`));
  const picked = { [`task-${a.id}`]: "on", [`task-${b.id}`]: "on" };
  assert.match(query(await admin.post("/work/bulk", { ...picked, action: "status", "value-status": "doing" }), "done"), /Changed 2/);
  assert.equal(t.services.projects.tasks.get(a.id)?.status, "doing");
  await admin.post("/work/bulk", { ...picked, action: "assign", "value-assign": sam });
  assert.equal(t.services.projects.tasks.get(b.id)?.assigneeId, sam);
  await admin.post("/work/bulk", { ...picked, action: "due", "value-due": "2026-12-11" });
  assert.equal(t.services.projects.tasks.get(a.id)?.dueOn, "2026-12-11");
  assert.match(query(await admin.post("/work/bulk", { action: "status", "value-status": "done" }), "problem"), /Tick at least one/);
  assert.match(query(await admin.post("/work/bulk", { ...picked, action: "status", "value-status": "archived" }), "problem"), /Choose what to do/);

  const { createInvoice } = await import("../../src/finance/index.ts");
  const one = unwrap(createInvoice(t.services.finance, mikey, project.id, { kind: "deposit", description: "Deposit", amount: "100" }));
  const two = unwrap(createInvoice(t.services.finance, mikey, project.id, { kind: "balance", description: "Balance", amount: "200" }));
  const ticked = { [`invoice-${one.id}`]: "on", [`invoice-${two.id}`]: "on" };
  assert.match(query(await admin.post(`/projects/${project.id}/invoices/send`, ticked), "problem"), /checked them/);
  assert.match(query(await admin.post(`/projects/${project.id}/invoices/send`, { ...ticked, checked: "on" }), "done"), /Marked 2 sent/);
  assert.equal(t.services.finance.invoices.get(two.id)?.status, "sent");
});

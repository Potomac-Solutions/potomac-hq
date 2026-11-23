// Invoice reminders over real HTTP and the morning run: off until turned on,
// to the client's primary contact, each step once, and an invoice can be left
// out on its own.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import { createServices } from "../../src/services.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

type Sent = { to: string; subject: string; body: string };
let t: TestApp;
let admin: Client;
let member: Client;
let invoiceId: Id;
const runOn = async (day: string, sent: Sent[]) =>
  finance.sendInvoiceReminders(createServices(t.db, { today: () => day, clock: () => `${day}T14:00:00Z` }).invoiceReminders, async (message) => (sent.push(message), true), { publicUrl: "https://hq.example", phone: "304-555-0142", address: "PO Box 12, Gormania, WV 26720" });
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  await member.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const { client, project } = await wonProject(t.services, mikey, { client: "Gormania Feed", title: "Feed store website" });
  unwrap(crm.addContact(t.services.crm, mikey, client.id, { name: "Bob Miller", email: "Bob@Feed.example", isPrimary: true }));
  const draft = unwrap(finance.createInvoice(t.services.finance, mikey, project.id, { kind: "full", description: "Website", amount: "1200", dueOn: "2026-12-04" }));
  invoiceId = draft.id;
  // Sent on Nov 20, due Dec 4.
  unwrap(finance.sendInvoiceNow(createServices(t.db, { today: () => "2026-11-20" }).finance, mikey, invoiceId));
});
after(() => t.stop());

test("off until turned on: nothing goes, and the pages say so", async () => {
  const sent: Sent[] = [];
  assert.deepEqual(await runOn("2026-12-05", sent), { sent: 0, failed: 0, skipped: 0 });
  assert.match(textOf(await admin.page("/money")), /Invoice reminders: off When on, clients are emailed/);
  assert.match(textOf(await admin.page(`/invoices/${invoiceId}`)), /Reminders Reminders are off for every invoice\./);
  assert.equal(problemOf(await member.post("/money/reminders", { on: "1" })), "You don’t have permission to do that.");
  assert.equal(doneOf(await admin.post("/money/reminders", { on: "1" })), "Saved.");
  assert.match(textOf(await admin.page("/money")), /Invoice reminders: on Clients are emailed/);
  assert.match(textOf(await admin.page(`/invoices/${invoiceId}`)), /Sent to bob@feed\.example, when one is due\./);
});

test("each step goes once, to the primary contact, saying what is owed and how to pay", async () => {
  const sent: Sent[] = [];
  assert.deepEqual(await runOn("2026-11-30", sent), { sent: 0, failed: 0, skipped: 0 }, "four days before");
  assert.deepEqual(await runOn("2026-12-01", sent), { sent: 1, failed: 0, skipped: 0 });
  assert.equal(sent[0]?.to, "bob@feed.example");
  assert.match(sent[0]?.subject ?? "", /^INV-0001 is due Fri, Dec 4/);
  assert.match(sent[0]?.body ?? "", /^Hi Bob,\n\nA reminder that invoice INV-0001 for Feed store website, \$1,200\.00, is due Fri, Dec 4/);
  assert.match(sent[0]?.body ?? "", /Mail it to: PO Box 12, Gormania, WV 26720/);
  assert.deepEqual(await runOn("2026-12-01", sent), { sent: 0, failed: 0, skipped: 0 }, "never twice");
  assert.deepEqual(await runOn("2026-12-05", sent), { sent: 1, failed: 0, skipped: 0 });
  assert.match(sent[1]?.subject ?? "", /was due/);
  assert.match(textOf(await admin.page(`/invoices/${invoiceId}`)), /Coming due: .*, to bob@feed\.example Due yesterday: /);
  assert.ok(actions(t.db).includes("invoice.reminder-sent"));
});

test("an invoice can be left out on its own; a paid one gets nothing", async () => {
  assert.equal(doneOf(await admin.post(`/invoices/${invoiceId}/reminders`, { off: "1" })), "Saved.");
  assert.match(textOf(await admin.page(`/invoices/${invoiceId}`)), /No reminders for this invoice\./);
  const sent: Sent[] = [];
  assert.deepEqual(await runOn("2026-12-11", sent), { sent: 0, failed: 0, skipped: 0 });
  await admin.post(`/invoices/${invoiceId}/reminders`, { off: "0" });
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  unwrap(finance.recordPayment(createServices(t.db, { today: () => "2026-12-10" }).finance, mikey, invoiceId, { amount: "1200", method: "check", on: "2026-12-10", reference: "1042" }));
  assert.deepEqual(await runOn("2026-12-18", sent), { sent: 0, failed: 0, skipped: 0 });
});

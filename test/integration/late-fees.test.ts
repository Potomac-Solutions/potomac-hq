// Late invoices (2026-11-26): an optional late fee, once, as its own invoice;
// and a call asked for at two weeks late.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { runLateInvoices } from "../../src/finance/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, signIn, testApp, textOf, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let stacy: Client;
let clientId: Id;
let mikey: Id;
const said = (res: Response, name: "done" | "problem") => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get(name) ?? "";
const daysAgo = (n: number) => Temporal.Now.plainDateISO("America/New_York").subtract({ days: n }).toString();
const bill = async (amount: string, dueOn: string) => /\/invoices\/([0-9a-f-]{36})/.exec((await admin.post(`/clients/${clientId}/invoices`, { kind: "other", description: "Hosting, a year", amount, dueOn, send: "on" })).headers.get("location") ?? "")?.[1] as Id;
const run = () => runLateInvoices(t.services.invoiceReminders);

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  clientId = won.client.id;
  stacy = await clientSignedIn(t, admin, clientId, "Stacy Roberts", "stacy@betterdays.example");
});
after(() => t.stop());

test("off by default: nothing charged; at two weeks late a call is asked for, once", async () => {
  assert.match(textOf(await admin.page("/money")), /Late fees: off/);
  const id = await bill("100", daysAgo(15));
  assert.deepEqual(run(), { fees: 0, calls: 1 });
  assert.deepEqual(run(), { fees: 0, calls: 0 }, "once");
  const todo = t.db.prepare("select title, assignee_id, organization_id from task where title like 'Call Better Days Towing about INV-%'").get();
  assert.equal(todo?.["assignee_id"], mikey);
  assert.ok(events(t.db).some((one) => one.action === "invoice.call-asked" && one.record === id));
});

test("a percent after 30 days: one fee invoice, in the portal; never a fee on the fee; never twice", async () => {
  assert.equal(said(await admin.post("/money/late-fee", { kind: "percent", amount: "15", afterDays: "30" }), "problem"), "Enter a percent from 0.01 to 10, or a dollar amount up to $1,000.");
  assert.equal(said(await admin.post("/money/late-fee", { kind: "percent", amount: "1.5", afterDays: "30" }), "done"), "Saved. HQ charges it each morning on invoices that reach the day.");
  assert.match(textOf(await admin.page("/money")), /Late fees: 1\.5% of what’s still owed, once, when an invoice is 30 days late/);
  const young = await bill("200", daysAgo(29));
  const old = await bill("200", daysAgo(31));
  await admin.post(`/invoices/${old}/payments`, { amount: "100", method: "check", on: daysAgo(0) });
  const before = run();
  assert.equal(before.fees, 1);
  const fee = t.db.prepare("select fee_invoice_id from invoice_late_fee where invoice_id = ?").get(old)?.["fee_invoice_id"] as Id;
  const feeInvoice = t.services.finance.invoices.get(fee);
  assert.deepEqual([feeInvoice?.status, feeInvoice?.total.minor], ["sent", 150], "1.5% of the $100 still owed");
  assert.match(feeInvoice?.lines[0]?.description ?? "", /^Late fee on INV-\d{4}, 31 days past due$/);
  assert.equal(t.db.prepare("select count(*) as n from invoice_late_fee where invoice_id = ?").get(young)?.["n"], 0);
  assert.equal(run().fees, 0, "never twice");
  assert.match(textOf(await stacy.page("/portal")), /Late fee on INV-\d{4}, 31 days past due/);
  // Time passes: the fee invoice itself goes 30 days late, and gets no fee.
  t.db.prepare("update invoice set due_on = ? where id = ?").run(daysAgo(40), fee);
  run();
  assert.equal(t.db.prepare("select count(*) as n from invoice_late_fee where invoice_id = ?").get(fee)?.["n"], 0);
});

test("a member can't set a late fee; off again stops new ones", async () => {
  const sam = await signIn(t, "sam@example.com", "Sam Teter", ["member"]);
  assert.equal(said(await sam.post("/money/late-fee", { kind: "flat", amount: "25", afterDays: "10" }), "problem"), "You don’t have permission to do that.");
  assert.equal(said(await admin.post("/money/late-fee", { kind: "off" }), "done"), "Late fees are off.");
  await bill("50", daysAgo(60));
  assert.equal(run().fees, 0);
});

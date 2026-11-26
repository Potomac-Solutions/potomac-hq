// Profit by client (2026-11-26).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import * as renewals from "../../src/renewals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
const today = () => Temporal.Now.plainDateISO("America/New_York").toString();

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("each client's year: paid, less expenses and renewal costs, per hour worked; refunds count; best per hour first", async () => {
  const s = t.services;
  const bakery = await wonProject(s, mikey, { client: "Mt. Storm Bakery", title: "Bakery website" });
  const towing = await wonProject(s, mikey, { client: "Better Days Towing", title: "Towing website" });
  const paid = async (projectId: Id, amount: string) => {
    const made = unwrap(finance.createInvoice(s.finance, mikey, projectId, { kind: "balance", description: "Work", amount }));
    unwrap(finance.sendInvoiceNow(s.finance, mikey, made.id));
    return unwrap(finance.recordPayment(s.finance, mikey, made.id, { amount, method: "check", on: today() })).payment;
  };
  await paid(bakery.project.id, "1200");
  const towPayment = await paid(towing.project.id, "500");
  unwrap(finance.recordRefund(s.finance, mikey, towPayment.id, { amount: "100", on: today(), reason: "Discount" }));
  const yesterday = Temporal.Now.plainDateISO("America/New_York").subtract({ days: 1 }).toString();
  const sameYear = yesterday.slice(0, 4) === today().slice(0, 4) ? yesterday : today();
  unwrap(finance.logTime(s.finance, mikey, { projectId: bakery.project.id }, { on: today(), hours: "10", billable: true }));
  unwrap(finance.logTime(s.finance, mikey, { projectId: bakery.project.id }, { on: sameYear, hours: "10", billable: true }));
  unwrap(finance.logTime(s.finance, mikey, { projectId: towing.project.id }, { on: today(), hours: "2", billable: true }));
  unwrap(finance.addExpense(s.finance, mikey, bakery.project.id, { category: "software", amount: "80", on: today() }));
  const renewsOn = `${today().slice(0, 4)}-12-30`;
  unwrap(renewals.addRenewal(s.renewals, mikey, bakery.client.id, { kind: "domain", name: "mtstormbakery.com", renewsOn, termMonths: "12", cost: "20", price: "25" }));

  const page = textOf(await admin.page("/money/clients"));
  assert.match(page, /Profit by client, \d{4}/);
  // Towing: $400 kept for 2 hours = $200 an hour. Bakery: $1,200 - $100 = $1,100 for 20 hours = $55 an hour.
  assert.match(page, /Better Days Towing \$500\.00 \$400\.00 \$0\.00 \$400\.00 2 h \$200\.00[\s\S]*Mt\. Storm Bakery \$1,200\.00 \$1,200\.00 \$100\.00 \$1,100\.00 20 h \$55\.00/);
  assert.match(page, /All clients\s+\$1,700\.00 \$1,600\.00 \$100\.00 \$1,500\.00 22 h \$68\.18/);
  const sam = await signIn(t, "sam@example.com", "Sam Teter", ["member"]);
  assert.equal((await sam.get("/money/clients")).status, 403);
});

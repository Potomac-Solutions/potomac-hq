// Profit and loss over real HTTP: received against spent by month, with
// invoiced alongside, a year at a time, and a CSV of every month.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import { createServices } from "../../src/services.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
const on = (day: string) => createServices(t.db, { today: () => day, clock: () => `${day}T15:00:00Z` }).finance;

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  await member.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const { project } = await wonProject(t.services, mikey, { client: "Gormania Feed", title: "Feed store website" });
  const invoice = unwrap(finance.createInvoice(t.services.finance, mikey, project.id, { kind: "full", description: "Website", amount: "1200" }));
  unwrap(finance.sendInvoiceNow(on("2025-12-15"), mikey, invoice.id));
  unwrap(finance.recordPayment(on("2026-01-10"), mikey, invoice.id, { amount: "400", method: "check", on: "2026-01-10", reference: "1001" }));
  unwrap(finance.recordPayment(on("2026-03-02"), mikey, invoice.id, { amount: "800", method: "cash", on: "2026-03-02" }));
  unwrap(finance.addExpense(on("2026-01-20"), mikey, project.id, { category: "hosting", amount: "30", on: "2026-01-20" }));
  unwrap(finance.addExpense(on("2026-03-05"), mikey, project.id, { category: "software", amount: "90", on: "2026-03-05" }));
});
after(() => t.stop());

test("this year by month, up to this month, with totals and what the money went on", async () => {
  const page = textOf(await admin.page("/money/profit?year=2026"));
  assert.match(page, /Profit and loss, 2026 .* Back to Money 2026 2025 By month/);
  assert.match(page, /January \$0\.00 \$400\.00 \$30\.00 \$370\.00 February \$0\.00 \$0\.00 \$0\.00 \$0\.00 March \$0\.00 \$800\.00 \$90\.00 \$710\.00/);
  assert.match(page, /2026 \$0\.00 \$1,200\.00 \$120\.00 \$1,080\.00/);
  assert.match(page, /What the money went on Category Spent Share Software \$90\.00 75% Hosting \$30\.00 25%/);
  assert.doesNotMatch(page, /December/, "not past this month");
});

test("last year shows what was invoiced then; a year with no records falls back to this one", async () => {
  assert.match(textOf(await admin.page("/money/profit?year=2025")), /December \$1,200\.00 \$0\.00 \$0\.00 \$0\.00/);
  assert.match(textOf(await admin.page("/money/profit?year=1999")), /Profit and loss, 2026/);
});

test("the CSV has every month since the first record; members may not see any of it", async () => {
  const csv = await (await admin.get("/exports/profit.csv")).text();
  assert.match(csv, /^Month,Invoiced,Received,Spent,Received less spent\r?\n2025-12,1200,0,0,0\r?\n2026-01,0,400,30,370\r?\n/);
  assert.equal((await member.get("/money/profit")).status, 403);
  assert.equal((await member.get("/exports/profit.csv")).status, 404);
});

// The year-end tax pack (2026-11-26).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";
import { png } from "../support/png.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
const today = () => Temporal.Now.plainDateISO("America/New_York").toString();
const year = () => today().slice(0, 4);

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("one zip: income with refunds, by client; expenses by category with receipts; owed; a readme with the totals", async () => {
  const s = t.services;
  const won = await wonProject(s, mikey, { client: "Mt. Storm Bakery", title: "Bakery website" });
  const one = unwrap(finance.createInvoice(s.finance, mikey, won.project.id, { kind: "balance", description: "Build", amount: "1000" }));
  unwrap(finance.sendInvoiceNow(s.finance, mikey, one.id));
  const { payment } = unwrap(finance.recordPayment(s.finance, mikey, one.id, { amount: "1000", method: "check", on: today(), reference: "1042" }));
  unwrap(finance.recordRefund(s.finance, mikey, payment.id, { amount: "50", on: today(), reason: "Discount" }));
  const owed = unwrap(finance.createInvoice(s.finance, mikey, won.project.id, { kind: "balance", description: "Hosting", amount: "300" }));
  unwrap(finance.sendInvoiceNow(s.finance, mikey, owed.id));
  unwrap(finance.addExpense(s.finance, mikey, won.project.id, { category: "hosting", amount: "40", on: today(), note: "Server", receipt: { name: "server bill.png", bytes: png(10, 10) } }));
  unwrap(finance.addExpense(s.finance, mikey, won.project.id, { category: "software", amount: "15", on: today() }));

  assert.match(textOf(await admin.page("/money")), new RegExp(`Year-end tax pack[\\s\\S]*Taxes for ${year()}`));
  const res = await admin.get(`/exports/tax-pack-${year()}.zip`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  const dir = mkdtempSync(join(tmpdir(), "taxpack-"));
  writeFileSync(join(dir, "pack.zip"), new Uint8Array(await res.arrayBuffer()));
  execFileSync("unzip", ["-q", "pack.zip"], { cwd: dir });
  const read = (name: string) => readFileSync(join(dir, `potomac-taxes-${year()}`, name), "utf8");
  const readme = read("README.txt");
  assert.match(readme, /Money in:\s+\$1,000\.00/);
  assert.match(readme, /Refunds given back:\s+\$50\.00/);
  assert.match(readme, /Expenses:\s+\$55\.00/);
  assert.match(readme, /Left:\s+\$895\.00/);
  assert.match(readme, /Not in here: card processing fees/);
  assert.match(read("income.csv"), /,1000,payment,1042/);
  assert.match(read("income.csv"), /,-50,refund,Refund/);
  assert.match(read("income-by-client.csv"), /Mt\. Storm Bakery,950/);
  assert.match(read("expenses.csv"), new RegExp(`Hosting,40,Mt\\. Storm Bakery,Bakery website,Server,receipts/${today()}-server-bill\\.png`));
  assert.match(read("expenses-by-category.csv"), /Hosting,40\r?\nSoftware,15/);
  assert.match(read("owed-at-year-end.csv"), /Mt\. Storm Bakery,\d{4}-\d\d-\d\d,,300,300/);
  assert.equal(readFileSync(join(dir, `potomac-taxes-${year()}`, "receipts", `${today()}-server-bill.png`)).length, png(10, 10).length);
});

test("only for someone who may export, and only for a year with money in it", async () => {
  const sam = await signIn(t, "sam@example.com", "Sam Teter", ["member"]);
  assert.equal((await sam.get(`/exports/tax-pack-${year()}.zip`)).status, 404);
  assert.doesNotMatch(textOf(await sam.page("/money")), /Year-end tax pack/);
  assert.equal((await admin.get("/exports/tax-pack-1999.zip")).status, 404);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { dollars, weeklyEmail } from "./weekly.ts";

const week = { from: "2026-11-16", to: "2026-11-22", moneyIn: 150000, moneyOut: 2599, owed: 50000, overdueInvoices: 1, newDeals: 3, won: 1, wonValue: 150000, lost: 0, atRisk: ["Towing site"], overdueTasks: 2, ai: "$3.10 of $20.00" };

test("last week in a few lines, with links, and the headline in the subject", () => {
  const mail = weeklyEmail(week, "Mikey Nichols", "https://hq.example/");
  assert.equal(mail.subject, "Last week in HQ: 1 invoice overdue, 1 project at risk");
  assert.match(mail.body, /^Good morning, Mikey\. Here's last week in HQ \(Nov 16 to Nov 22\)\./);
  assert.match(mail.body, /In: \$1,500\.00\. Out: \$25\.99\./);
  assert.match(mail.body, /3 new deals, 1 won \(\$1,500\.00\), 0 lost\./);
  assert.match(mail.body, /At risk: Towing site\./);
  assert.match(mail.body, /https:\/\/hq\.example\/workload/);
  assert.equal(weeklyEmail({ ...week, overdueInvoices: 0, atRisk: [] }, "", "x").subject, "Last week in HQ");
  assert.equal(dollars(5), "$0.05");
});

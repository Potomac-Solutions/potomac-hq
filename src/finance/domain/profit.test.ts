import assert from "node:assert/strict";
import { test } from "node:test";
import { profitByMonth } from "./profit.ts";

test("each month in the range, empty ones too, with received less spent", () => {
  const table = profitByMonth(
    {
      invoiced: [{ on: "2026-09-02", minor: 120000 }, { on: "2026-11-01", minor: 4900 }],
      received: [{ on: "2026-09-20", minor: 40000 }, { on: "2026-11-03", minor: 80000 }, { on: "2026-12-01", minor: 999 }],
      spent: [{ on: "2026-09-05", minor: 1044, category: "domain" }, { on: "2026-11-10", minor: 2500, category: "hosting" }, { on: "2026-11-11", minor: 3000, category: "domain" }],
    },
    "2026-09",
    "2026-11",
  );
  assert.deepEqual(table.months, [
    { month: "2026-09", invoiced: 120000, received: 40000, spent: 1044, net: 38956 },
    { month: "2026-10", invoiced: 0, received: 0, spent: 0, net: 0 },
    { month: "2026-11", invoiced: 4900, received: 80000, spent: 5500, net: 74500 },
  ]);
  assert.deepEqual(table.totals, { invoiced: 124900, received: 120000, spent: 6544, net: 113456 });
  assert.deepEqual(table.byCategory, [{ category: "domain", minor: 4044 }, { category: "hosting", minor: 2500 }]);
});

test("a year that crosses into the next", () => {
  assert.deepEqual(profitByMonth({ invoiced: [], received: [], spent: [] }, "2026-12", "2027-01").months.map((row) => row.month), ["2026-12", "2027-01"]);
});

test("profit by client: received less expenses and renewal costs, and what each hour earned", async () => {
  const { profitByClient } = await import("./profit.ts");
  const rows = profitByClient(
    new Map([
      ["bakery", { invoiced: 150000, received: 120000, expenses: 10000, renewalCost: 2000, minutes: 1200 }],
      ["towing", { invoiced: 50000, received: 50000, expenses: 0, renewalCost: 0, minutes: 120 }],
      ["farm", { invoiced: 2000, received: 2000, expenses: 0, renewalCost: 1500, minutes: 0 }],
      ["diner", { invoiced: 0, received: 0, expenses: 3000, renewalCost: 0, minutes: 600 }],
    ]),
  );
  assert.deepEqual(rows.map((one) => one.key), ["towing", "bakery", "diner", "farm"]);
  assert.equal(rows[0]?.profit.perHour, 25000, "$500 for 2 hours");
  assert.equal(rows[1]?.profit.net, 108000);
  assert.equal(rows[1]?.profit.perHour, 5400);
  assert.equal(rows[2]?.profit.perHour, -300, "time spent and money out: it shows as a loss");
  assert.equal(rows[3]?.profit.perHour, null);
});

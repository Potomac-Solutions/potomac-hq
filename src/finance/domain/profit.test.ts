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

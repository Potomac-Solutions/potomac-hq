// Profit and loss by month, on a cash basis: money received against money
// spent, with what was invoiced alongside. A management view: the Google
// Sheet copy is the book of record for taxes (docs/tool-boundaries.md).
export type Dated = { readonly on: string; readonly minor: number };
export type Spent = Dated & { readonly category: string };

export type MonthRow = {
  /** "2026-11" */
  readonly month: string;
  readonly invoiced: number;
  readonly received: number;
  readonly spent: number;
  readonly net: number;
};

export type ProfitTable = {
  readonly months: readonly MonthRow[];
  readonly totals: Omit<MonthRow, "month">;
  /** What was spent on, largest first. */
  readonly byCategory: readonly { readonly category: string; readonly minor: number }[];
};

/** Every month from `from` to `to` ("2026-01" to "2026-11"), each with its sums, even an empty one. */
export function profitByMonth(input: { readonly invoiced: readonly Dated[]; readonly received: readonly Dated[]; readonly spent: readonly Spent[] }, from: string, to: string): ProfitTable {
  const months: MonthRow[] = [];
  const inMonth = (rows: readonly Dated[], month: string) => rows.filter((row) => row.on.startsWith(`${month}-`)).reduce((sum, row) => sum + row.minor, 0);
  for (let month = Temporal.PlainYearMonth.from(from); Temporal.PlainYearMonth.compare(month, to) <= 0; month = month.add({ months: 1 })) {
    const key = month.toString();
    const received = inMonth(input.received, key);
    const spent = inMonth(input.spent, key);
    months.push({ month: key, invoiced: inMonth(input.invoiced, key), received, spent, net: received - spent });
  }
  const totals = months.reduce((sum, row) => ({ invoiced: sum.invoiced + row.invoiced, received: sum.received + row.received, spent: sum.spent + row.spent, net: sum.net + row.net }), { invoiced: 0, received: 0, spent: 0, net: 0 });
  const inRange = (on: string) => on.slice(0, 7) >= from && on.slice(0, 7) <= to;
  const categories = new Map<string, number>();
  for (const row of input.spent) if (inRange(row.on)) categories.set(row.category, (categories.get(row.category) ?? 0) + row.minor);
  return { months, totals, byCategory: [...categories].map(([category, minor]) => ({ category, minor })).toSorted((a, b) => b.minor - a.minor) };
}

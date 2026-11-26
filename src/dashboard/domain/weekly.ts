// The weekly owner email (quality of life, 2026-11-25): every Monday, to
// each admin, last week in a few lines: money in and out, what's owed,
// pipeline movement, work at risk and AI spend, with links into HQ.

export type WeekFacts = {
  /** Monday and Sunday of last week, YYYY-MM-DD. */
  readonly from: string;
  readonly to: string;
  readonly moneyIn: number;
  readonly moneyOut: number;
  readonly owed: number;
  readonly overdueInvoices: number;
  readonly newDeals: number;
  readonly won: number;
  readonly wonValue: number;
  readonly lost: number;
  readonly atRisk: readonly string[];
  readonly overdueTasks: number;
  /** This month's AI spend against its cap, in words: "$3.10 of $20.00". */
  readonly ai: string;
};

/** Minor units (cents) as dollars: "$1,234.50". */
export const dollars = (minor: number): string => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const day = (iso: string) => {
  const [year, month, date] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

export function weeklyEmail(facts: WeekFacts, name: string, base: string): { readonly subject: string; readonly body: string } {
  const link = (path: string) => `${base.replace(/\/$/, "")}${path}`;
  const lines = [
    `Good morning${name ? `, ${name.split(" ")[0]}` : ""}. Here's last week in HQ (${day(facts.from)} to ${day(facts.to)}).`,
    "",
    "Money",
    `  In: ${dollars(facts.moneyIn)}. Out: ${dollars(facts.moneyOut)}.`,
    `  Still owed: ${dollars(facts.owed)}${facts.overdueInvoices > 0 ? `, with ${plural(facts.overdueInvoices, "invoice", "invoices")} overdue` : ""}.`,
    `  ${link("/money")}`,
    "",
    "Pipeline",
    `  ${plural(facts.newDeals, "new deal", "new deals")}, ${facts.won} won${facts.won > 0 ? ` (${dollars(facts.wonValue)})` : ""}, ${facts.lost} lost.`,
    `  ${link("/pipeline")}`,
    "",
    "Work",
    facts.atRisk.length > 0 ? `  At risk: ${facts.atRisk.join(", ")}.` : "  No project is at risk.",
    `  ${facts.overdueTasks > 0 ? `${plural(facts.overdueTasks, "task is", "tasks are")} overdue.` : "Nothing is overdue."}`,
    `  ${link("/workload")}`,
    "",
    "AI",
    `  ${facts.ai} spent this month.`,
    "",
    `Everything else: ${link("/")}`,
  ];
  const headline = facts.overdueInvoices > 0 || facts.atRisk.length > 0 ? `: ${[...(facts.overdueInvoices > 0 ? [plural(facts.overdueInvoices, "invoice overdue", "invoices overdue")] : []), ...(facts.atRisk.length > 0 ? [plural(facts.atRisk.length, "project at risk", "projects at risk")] : [])].join(", ")}` : "";
  return { subject: `Last week in HQ${headline}`, body: lines.join("\n") };
}

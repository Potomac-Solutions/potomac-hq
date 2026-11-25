// The monthly report to a plan client (decision 0013, section 4): what their
// month looked like (the site up, the work done, what's coming, what's
// waiting on them), in plain words, from HQ's own records. Hours are left
// out: the plans are unlimited support.
import { optionalText } from "../../shared/domain/fields.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";
import type { Id } from "../../shared/domain/id.ts";

export type ReportStatus = "draft" | "sent" | "skipped";

export type MonthlyReport = {
  readonly id: Id;
  readonly organizationId: Id;
  /** YYYY-MM: the month it's about. */
  readonly month: string;
  readonly status: ReportStatus;
  /** The report as HQ wrote it, before anyone's own line. */
  readonly body: string;
  /** A line of Potomac's own, put after the greeting. */
  readonly note: string;
  readonly sentTo: string | null;
  readonly sentAt: string | null;
};

export type SiteFact = { readonly host: string; readonly outages: readonly { readonly start: string; readonly end: string | null }[] };

export type MonthFacts = {
  readonly sites: readonly SiteFact[];
  readonly tasksDone: number;
  readonly milestonesDone: readonly string[];
  readonly sitePublishes: number;
  readonly changesApproved: readonly string[];
  readonly comingUp: readonly { readonly what: string; readonly on: string }[];
  readonly invoicesToPay: number;
  readonly approvalsWaiting: number;
};

/** "2026-10" for the month before the day given. */
export function lastMonth(today: string): string {
  return Temporal.PlainDate.from(today).toPlainYearMonth().subtract({ months: 1 }).toString();
}

/** The month's first and last instants, in the business time zone. */
export function monthBounds(month: string, zone: string): { readonly from: string; readonly to: string } {
  const first = Temporal.PlainYearMonth.from(month).toPlainDate({ day: 1 });
  return { from: first.toZonedDateTime(zone).toInstant().toString(), to: first.add({ months: 1 }).toZonedDateTime(zone).toInstant().toString() };
}

export const monthLabel = (month: string): string => Temporal.PlainYearMonth.from(month).toPlainDate({ day: 1 }).toLocaleString("en-US", { month: "long", year: "numeric" });

/** How long a site was up in the month, as a person reads it. */
export function upText(site: SiteFact, from: string, to: string): string {
  const total = Temporal.Instant.from(to).epochMilliseconds - Temporal.Instant.from(from).epochMilliseconds;
  let down = 0;
  for (const outage of site.outages) {
    const start = Math.max(Temporal.Instant.from(outage.start).epochMilliseconds, Temporal.Instant.from(from).epochMilliseconds);
    const end = Math.min(Temporal.Instant.from(outage.end ?? to).epochMilliseconds, Temporal.Instant.from(to).epochMilliseconds);
    if (end > start) down += end - start;
  }
  if (down === 0) return `${site.host} was up the whole month.`;
  const share = 100 - (down / total) * 100;
  const minutes = Math.max(1, Math.round(down / 60_000));
  const howLong = minutes < 90 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : `${Math.round(minutes / 60)} hours`;
  return `${site.host} was up ${share >= 99.995 ? "99.99" : share.toFixed(2)}% of the month (down ${howLong} in all).`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dayText = (day: string) => Temporal.PlainDate.from(day).toLocaleString("en-US", { month: "long", day: "numeric" });

/** The report, from the facts. Sections with nothing to say are left out. */
export function composeReport(input: { readonly clientName: string; readonly month: string; readonly zone: string; readonly facts: MonthFacts }): string {
  const { facts } = input;
  const { from, to } = monthBounds(input.month, input.zone);
  const sections: string[] = [];
  if (facts.sites.length > 0) sections.push(["Your website", ...facts.sites.map((site) => `- ${upText(site, from, to)}`)].join("\n"));
  const done = [
    ...facts.milestonesDone.map((name) => `- Finished: ${name}`),
    ...(facts.sitePublishes > 0 ? [`- Put ${plural(facts.sitePublishes, "update", "updates")} live on your website`] : []),
    ...facts.changesApproved.map((title) => `- Your change: ${title}`),
    ...(facts.tasksDone > 0 ? [`- ${plural(facts.tasksDone, "task", "tasks")} done in all`] : []),
  ];
  if (done.length > 0) sections.push(["What we did", ...done].join("\n"));
  if (facts.comingUp.length > 0) sections.push(["Coming up", ...facts.comingUp.map((one) => `- ${one.what}, ${dayText(one.on)}`)].join("\n"));
  const waiting = [...(facts.approvalsWaiting > 0 ? [`- ${plural(facts.approvalsWaiting, "piece of work", "pieces of work")} to look at and approve in your portal`] : []), ...(facts.invoicesToPay > 0 ? [`- ${plural(facts.invoicesToPay, "invoice", "invoices")} to pay`] : [])];
  if (waiting.length > 0) sections.push(["Waiting on you", ...waiting].join("\n"));
  if (sections.length === 0) sections.push("A quiet month: everything ran as it should.");
  return [`Here’s ${input.clientName}’s month with Potomac Solutions: ${monthLabel(input.month)}.`, ...sections].join("\n\n");
}

/** The email the client gets: a greeting, Potomac's own line, the report and how to reach us. */
export function reportEmail(report: Pick<MonthlyReport, "body" | "note" | "month">, to: { readonly name: string }, contactLine: string): { readonly subject: string; readonly body: string } {
  const first = to.name.trim().split(/\s+/)[0] ?? "";
  const lines = [`Hi${first ? ` ${first}` : ""},`, "", ...(report.note ? [report.note, ""] : []), report.body, "", `Questions about any of it? ${contactLine}`, "", "Mikey and Jayanti", "Potomac Solutions"];
  return { subject: `Your month with Potomac Solutions: ${monthLabel(report.month)}`, body: lines.join("\n") };
}

export function cleanNote(typed: string): Result<string, "note-too-long"> {
  const note = optionalText(typed.replace(/\r\n/g, "\n"), 1000);
  return note.ok ? ok(note.value ?? "") : err("note-too-long");
}

/** Reports are drafted in the first week of a month, for the month before. */
export const DRAFT_DAYS = 7;

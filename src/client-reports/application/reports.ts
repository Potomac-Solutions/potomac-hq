// Monthly reports to plan clients (decision 0010, section 4). In the first
// week of each month HQ drafts one for every client with an ongoing project,
// from its own records. Someone with `client-report.send` reads it, adds a
// line if they like, and sends it, or skips it. Nothing goes by itself. Sent
// reports stay in the client's portal.
import { cleanNote, composeReport, DRAFT_DAYS, lastMonth, monthBounds, monthLabel, reportEmail, type MonthlyReport } from "../domain/report.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { FactsReader, ReportStore } from "./ports.ts";

export type ReportsDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly today: () => string;
  readonly zone: string;
  readonly formatWhen: (instant: string) => string;
  readonly reports: ReportStore;
  readonly facts: FactsReader;
  /** Clients with an ongoing project that is active, real ones only. */
  readonly planClients: () => readonly { readonly id: Id; readonly name: string }[];
  readonly clientName: (id: Id) => string | null;
  /** Who gets a client's report: their primary contact with an email, or else a portal user. */
  readonly recipientFor: (organizationId: Id) => { readonly name: string; readonly email: string } | null;
};

type Refused = "forbidden" | "not-found";
const allowed = (deps: ReportsDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "client-report.send").ok;
const HORIZON_DAYS = 60;

function draftFor(deps: ReportsDeps, client: { readonly id: Id; readonly name: string }, month: string, actorId: Id | null): MonthlyReport | null {
  if (deps.reports.forMonth(client.id, month)) return null;
  const { from, to } = monthBounds(month, deps.zone);
  const today = deps.today();
  const facts = deps.facts(client.id, { from, to, today, horizon: Temporal.PlainDate.from(today).add({ days: HORIZON_DAYS }).toString() });
  const report: MonthlyReport = { id: deps.newId(), organizationId: client.id, month, status: "draft", body: composeReport({ clientName: client.name, month, zone: deps.zone, facts }), note: "", sentTo: null, sentAt: null };
  deps.reports.insert(report, deps.clock());
  recordActivity(deps, { actorId, action: "monthly-report.drafted", recordType: "monthly-report", recordId: report.id, context: { organizationId: client.id, month } });
  return report;
}

/**
 * Drafts last month's reports that aren't drafted yet. Run each morning; it
 * does something only in the first week of a month, and only once a client.
 */
export function draftMonthlyReports(deps: ReportsDeps): number {
  const today = deps.today();
  if (Temporal.PlainDate.from(today).day > DRAFT_DAYS) return 0;
  const month = lastMonth(today);
  return deps.transact(() => deps.planClients().filter((client) => draftFor(deps, client, month, null) !== null).length);
}

/** Drafts last month's missing reports now, whatever the day. */
export function draftReportsNow(deps: ReportsDeps, actorId: Id | null): Result<{ readonly drafted: number }, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const month = lastMonth(deps.today());
  return ok({ drafted: deps.transact(() => deps.planClients().filter((client) => draftFor(deps, client, month, actorId) !== null).length) });
}

const STATUS_TEXT: Readonly<Record<MonthlyReport["status"], string>> = { draft: "To send", sent: "Sent", skipped: "Skipped" };

export type ReportLine = { readonly id: string; readonly clientId: string; readonly clientName: string; readonly status: string; readonly draft: boolean; readonly to: string; readonly sent: string };
export type ReportsView = { readonly month: string; readonly monthText: string; readonly months: readonly { readonly value: string; readonly label: string }[]; readonly lines: readonly ReportLine[]; readonly drafts: number; readonly planClients: number };

/** A month's reports, drafts first. */
export function monthlyReports(deps: ReportsDeps, actorId: Id | null, typedMonth: string): Result<ReportsView, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const latest = lastMonth(deps.today());
  const months = Array.from({ length: 12 }, (_, back) => Temporal.PlainYearMonth.from(latest).subtract({ months: back }).toString());
  const month = months.includes(typedMonth) ? typedMonth : latest;
  const lines = deps.reports
    .listMonth(month)
    .map((report): ReportLine => {
      const to = report.sentTo ?? deps.recipientFor(report.organizationId)?.email ?? "";
      return { id: report.id, clientId: report.organizationId, clientName: deps.clientName(report.organizationId) ?? "", status: STATUS_TEXT[report.status], draft: report.status === "draft", to, sent: report.sentAt ? deps.formatWhen(report.sentAt) : "" };
    })
    .sort((a, b) => Number(b.draft) - Number(a.draft) || a.clientName.localeCompare(b.clientName));
  return ok({ month, monthText: monthLabel(month), months: months.map((value) => ({ value, label: monthLabel(value) })), lines, drafts: lines.filter((one) => one.draft).length, planClients: deps.planClients().length });
}

export type ReportDetail = {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly monthText: string;
  readonly status: string;
  readonly draft: boolean;
  readonly note: string;
  readonly to: string;
  readonly toName: string;
  readonly subject: string;
  readonly email: string;
  readonly sent: string;
};

export function reportDetail(deps: ReportsDeps, actorId: Id | null, id: Id, contactLine: string): Result<ReportDetail, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const report = deps.reports.get(id);
  if (!report) return err("not-found");
  const recipient = report.sentTo ? { name: "", email: report.sentTo } : deps.recipientFor(report.organizationId);
  const mail = reportEmail(report, { name: recipient?.name ?? "" }, contactLine);
  return ok({ id: report.id, clientId: report.organizationId, clientName: deps.clientName(report.organizationId) ?? "", monthText: monthLabel(report.month), status: STATUS_TEXT[report.status], draft: report.status === "draft", note: report.note, to: recipient?.email ?? "", toName: recipient?.name ?? "", subject: mail.subject, email: mail.body, sent: report.sentAt ? deps.formatWhen(report.sentAt) : "" });
}

/** Potomac's own line, at the top of a draft. */
export function saveReportNote(deps: ReportsDeps, actorId: Id | null, id: Id, typed: string): Result<MonthlyReport, Refused | "note-too-long" | "not-draft"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const note = cleanNote(typed);
  if (!note.ok) return note;
  return deps.transact(() => {
    const report = deps.reports.get(id);
    if (!report) return err("not-found");
    if (report.status !== "draft") return err("not-draft");
    const changed = { ...report, note: note.value };
    deps.reports.save(changed, null, deps.clock());
    recordActivity(deps, { actorId, action: "monthly-report.note-changed", recordType: "monthly-report", recordId: id, context: { organizationId: report.organizationId, month: report.month } });
    return ok(changed);
  });
}

export function skipReport(deps: ReportsDeps, actorId: Id | null, id: Id): Result<MonthlyReport, Refused | "not-draft"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const report = deps.reports.get(id);
    if (!report) return err("not-found");
    if (report.status !== "draft") return err("not-draft");
    const skipped: MonthlyReport = { ...report, status: "skipped" };
    deps.reports.save(skipped, null, deps.clock());
    recordActivity(deps, { actorId, action: "monthly-report.skipped", recordType: "monthly-report", recordId: id, context: { organizationId: report.organizationId, month: report.month } });
    return ok(skipped);
  });
}

/** Sends a draft to the client's contact, once. */
export async function sendReport(deps: ReportsDeps, actorId: Id | null, id: Id, mail: ((message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>) | null, contactLine: string): Promise<Result<{ readonly to: string }, Refused | "not-draft" | "no-email" | "email-off" | "send-failed">> {
  if (!allowed(deps, actorId)) return err("forbidden");
  if (!mail) return err("email-off");
  const report = deps.reports.get(id);
  if (!report) return err("not-found");
  if (report.status !== "draft") return err("not-draft");
  const to = deps.recipientFor(report.organizationId);
  if (!to) return err("no-email");
  // Claimed before sending, so two presses never send it twice.
  const claimed = deps.transact(() => {
    const fresh = deps.reports.get(id);
    if (!fresh || fresh.status !== "draft") return null;
    const at = deps.clock();
    const sent: MonthlyReport = { ...fresh, status: "sent", sentTo: to.email, sentAt: at };
    deps.reports.save(sent, actorId, at);
    return fresh;
  });
  if (!claimed) return err("not-draft");
  const message = reportEmail(claimed, to, contactLine);
  const went = await mail({ to: to.email, ...message }).catch(() => false);
  return deps.transact(() => {
    if (!went) {
      deps.reports.save(claimed, null, deps.clock());
      return err("send-failed");
    }
    recordActivity(deps, { actorId, action: "monthly-report.sent", recordType: "monthly-report", recordId: id, context: { organizationId: claimed.organizationId, month: claimed.month } });
    return ok({ to: to.email });
  });
}

/** Drafts waiting to be sent, for Today. */
export function reportsToSend(deps: ReportsDeps, actorId: Id | null): readonly { readonly id: string; readonly text: string; readonly detail: string; readonly month: string }[] {
  if (!allowed(deps, actorId)) return [];
  return deps.reports.drafts().map((report) => ({ id: report.id, text: `Send ${deps.clientName(report.organizationId) ?? "a client"}’s monthly report`, detail: monthLabel(report.month), month: report.month }));
}

// ---------- The client's side ----------

export type PortalReportLine = { readonly id: string; readonly monthText: string; readonly sent: string };

/** The signed-in client's sent reports, newest first. */
export function portalReports(deps: ReportsDeps, organizationId: Id | null): readonly PortalReportLine[] {
  if (!organizationId) return [];
  return deps.reports.sentFor(organizationId).map((report) => ({ id: report.id, monthText: monthLabel(report.month), sent: report.sentAt ? deps.formatWhen(report.sentAt) : "" }));
}

/** One of them, as it was sent. Another client's, or a draft, is not found. */
export function portalReport(deps: ReportsDeps, organizationId: Id | null, id: Id): { readonly monthText: string; readonly note: string; readonly body: string } | null {
  const report = deps.reports.get(id);
  if (!organizationId || !report || report.organizationId !== organizationId || report.status !== "sent") return null;
  return { monthText: monthLabel(report.month), note: report.note, body: report.body };
}

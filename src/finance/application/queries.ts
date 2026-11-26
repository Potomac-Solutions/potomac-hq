// What the time and money pages show. Everyone who logs time sees their own.
// Costs, budgets and margins need `finance.view`, which a member does not
// hold. Revenue and margin here are operational estimates, not the books.
import { budgetPeriod, budgetWarning, defaultFinance, standing, type Budget, type BudgetWarning, type Standing } from "../domain/budget.ts";
import { depositShare, invoiceLabel, type Invoice } from "../domain/invoice.ts";
import { CATEGORY_LABELS, INVOICE_KIND_LABELS, INVOICE_STATUS_LABELS, METHOD_LABELS, options, PAYMENT_LABELS } from "../domain/labels.ts";
import { weekOf } from "../domain/time.ts";
import { EVERY_LABELS, monthlyMinor, nextAfter, type RecurringInvoice } from "../domain/recurring.ts";
import { prepaidBalance } from "../domain/prepaid.ts";
import { profitByMonth, type Dated, type Spent } from "../domain/profit.ts";
import { authorize } from "../../identity/index.ts";
import { milestoneProgress, type Project } from "../../projects/index.ts";
import { err, formatHours, formatMoney, friendlyDay, ok, readableHours, recordActivity, toCsv, type Cell, type Id, type Money, type Result } from "../../shared/index.ts";
import type { FinanceDeps, Refused } from "./commands.ts";
import type { InvoiceRow, TimeRow } from "./ports.ts";

export type Option = { readonly value: string; readonly label: string };

const may = (deps: FinanceDeps, actorId: Id | null, action: string): boolean => actorId !== null && authorize(deps, actorId, action).ok;
const usd = (minor: number): Money => ({ minor, currency: "USD" });

/** "2:15 PM" style clock time is not needed: a timer says how long it has run. */
function runningFor(deps: FinanceDeps, startedAt: string): string {
  const minutes = Math.max(0, Math.floor(Temporal.Instant.from(deps.clock()).since(Temporal.Instant.from(startedAt)).total("minutes")));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export type TimerView = { readonly running: boolean; readonly label: string; readonly taskId: string; readonly since: string; readonly can: boolean };

/** The actor's running timer, for the Time page and the dashboard. */
export function runningTimer(deps: FinanceDeps, actorId: Id | null): TimerView {
  const none = { running: false, label: "", taskId: "", since: "" };
  if (actorId === null || !may(deps, actorId, "time.log")) return { ...none, can: false };
  const entry = deps.time.running(actorId);
  if (!entry || !entry.startedAt) return { ...none, can: true };
  return { running: true, label: entry.taskTitle ? `${entry.taskTitle} · ${entry.projectName}` : entry.projectName, taskId: entry.taskId ?? "", since: runningFor(deps, entry.startedAt), can: true };
}

export type TaskTimeView = { readonly can: boolean; readonly logged: string; readonly running: boolean; readonly since: string };

/** Time on one task, for its page: what is logged, and whether the viewer's timer is on it. */
export function taskTime(deps: FinanceDeps, actorId: Id | null, taskId: Id): TaskTimeView {
  if (actorId === null || !may(deps, actorId, "time.log")) return { can: false, logged: "0", running: false, since: "" };
  const mine = deps.time.running(actorId);
  const onThis = mine !== null && mine.taskId === taskId && mine.startedAt !== null;
  return { can: true, logged: readableHours(deps.time.minutesOnTask(taskId)), running: onThis, since: onThis && mine.startedAt ? runningFor(deps, mine.startedAt) : "" };
}

type EntryView = {
  readonly id: string;
  readonly on: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly taskTitle: string;
  readonly who: string;
  readonly hours: string;
  readonly note: string;
  readonly billable: boolean;
  readonly running: boolean;
};

const entryView = (row: TimeRow): EntryView => ({
  id: row.id,
  on: row.workedOn,
  projectId: row.projectId,
  projectName: row.projectName,
  taskTitle: row.taskTitle ?? "",
  who: row.userName,
  hours: row.minutes === null ? "" : readableHours(row.minutes),
  note: row.note,
  billable: row.billable,
  running: row.minutes === null,
});

export type TimeSheetView = {
  readonly week: { readonly from: string; readonly to: string; readonly previous: string; readonly next: string; readonly isThisWeek: boolean };
  readonly everyone: boolean;
  readonly canSeeEveryone: boolean;
  readonly entries: readonly EntryView[];
  readonly total: string;
  readonly billable: string;
  readonly timer: TimerView;
  /** What time can be logged against: each active project, then each of its open tasks. */
  readonly targets: readonly Option[];
  readonly today: string;
};

/** A week of time: the actor's own, or everyone's for someone with `time.view-all`. */
export function timeSheet(deps: FinanceDeps, actorId: Id | null, filter: { readonly week?: string; readonly everyone?: boolean } = {}): Result<TimeSheetView, "forbidden"> {
  if (actorId === null || !may(deps, actorId, "time.log")) return err("forbidden");
  const today = deps.today();
  const anchor = filter.week && /^\d{4}-\d{2}-\d{2}$/.test(filter.week) && isDate(filter.week) ? filter.week : today;
  const week = weekOf(anchor);
  const canSeeEveryone = may(deps, actorId, "time.view-all");
  const everyone = canSeeEveryone && filter.everyone === true;
  const rows = deps.time.list(week, everyone ? null : actorId);
  const done = rows.filter((row) => row.minutes !== null);
  const targets: Option[] = [];
  for (const project of deps.projects.list().filter((one) => one.status === "active")) {
    targets.push({ value: project.id, label: `${project.name} (${project.clientName})` });
    for (const task of deps.tasks.listFor(project.id).filter((one) => one.status !== "done")) targets.push({ value: `${project.id}:${task.id}`, label: `${project.name}: ${task.title}` });
  }
  const shift = (days: number) => Temporal.PlainDate.from(week.from).add({ days }).toString();
  return ok({
    week: { ...week, previous: shift(-7), next: shift(7), isThisWeek: week.from === weekOf(today).from },
    everyone,
    canSeeEveryone,
    entries: rows.map(entryView),
    total: readableHours(done.reduce((sum, row) => sum + (row.minutes ?? 0), 0)),
    billable: readableHours(done.filter((row) => row.billable).reduce((sum, row) => sum + (row.minutes ?? 0), 0)),
    timer: runningTimer(deps, actorId),
    targets,
    today,
  });
}

function isDate(text: string): boolean {
  try {
    Temporal.PlainDate.from(text, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

export type HoursThisWeekView = { readonly mine: string; readonly everyone: string; readonly showEveryone: boolean; readonly timer: TimerView };

/** The dashboard's hours panel. */
export function hoursThisWeek(deps: FinanceDeps, actorId: Id | null): Result<HoursThisWeekView, "forbidden"> {
  if (actorId === null || !may(deps, actorId, "time.log")) return err("forbidden");
  const week = weekOf(deps.today());
  const sum = (rows: readonly TimeRow[]) => readableHours(rows.reduce((total, row) => total + (row.minutes ?? 0), 0));
  const showEveryone = may(deps, actorId, "time.view-all");
  return ok({ mine: sum(deps.time.list(week, actorId)), everyone: showEveryone ? sum(deps.time.list(week, null)) : "", showEveryone, timer: runningTimer(deps, actorId) });
}

/** A project's budget (by hand, or the accepted proposal's), its actuals for the budget's period, and how they compare. */
function measure(deps: FinanceDeps, project: Project, today: string) {
  const finance = deps.finance.get(project.id) ?? defaultFinance(project.id);
  const baseline = deps.baselines.get(project.id);
  const pricing = baseline?.pricing ?? deps.opportunities.get(project.opportunityId)?.pricing ?? null;
  const period = budgetPeriod(project.kind === "ongoing" ? pricing : "fixed", today);
  // An hourly proposal's "total" is its estimate of hours × rate, so it is a budget too.
  const budget: Budget = { amount: finance.budget ?? baseline?.amount ?? null, minutes: finance.budgetMinutes ?? (baseline && baseline.minutes > 0 ? baseline.minutes : null) };
  const time = deps.time.totals(project.id, period);
  const expenses = usd(deps.expenses.total(project.id, period));
  const s = standing(budget, { ...time, expenses }, finance.rate);
  // Milestones measure a one-time job's progress; a monthly or yearly plan has no end to measure against.
  const done = project.kind === "ongoing" ? null : milestoneProgress(deps.milestones.listFor(project.id));
  return { finance, baseline, period, budget, time, expenses, standing: s, warning: budgetWarning(budget, time, s, done), fromProposal: finance.budget === null && finance.budgetMinutes === null && baseline !== null };
}

type MoneyLine = { readonly budget: string; readonly actual: string; readonly over: boolean };

function summaryOf(budget: Budget, time: { minutes: number; billableMinutes: number }, expenses: Money, s: Standing) {
  return {
    hours: { budget: budget.minutes === null ? "" : readableHours(budget.minutes), actual: readableHours(time.minutes), over: s.overHours } satisfies MoneyLine,
    cost: { budget: budget.amount === null ? "" : formatMoney(budget.amount), actual: formatMoney(s.cost), over: s.overCost } satisfies MoneyLine,
    billableHours: readableHours(time.billableMinutes),
    timeCost: formatMoney(s.timeCost),
    expenses: formatMoney(expenses),
    margin: s.margin === null ? "" : formatMoney(s.margin),
    marginPercent: s.marginPercent === null ? "" : `${s.marginPercent}%`,
    marginNegative: s.margin !== null && s.margin.minor < 0,
    over: s.over,
  };
}

export type ProjectMoneyView = {
  readonly project: { readonly id: string; readonly name: string; readonly active: boolean };
  readonly period: string;
  readonly fromProposal: boolean;
  readonly summary: ReturnType<typeof summaryOf>;
  /** Over budget, or worth watching: three quarters used ahead of the work. */
  readonly warning: { readonly level: "over" | "watch"; readonly text: string } | null;
  readonly phases: readonly { readonly key: string; readonly name: string; readonly estimate: string; readonly actual: string; readonly over: boolean }[];
  readonly payment: { readonly status: string; readonly statusLabel: string; readonly invoiceRef: string };
  readonly budgetForm: { readonly amount: string; readonly hours: string; readonly rate: string };
  readonly expenses: readonly { readonly id: string; readonly on: string; readonly categoryLabel: string; readonly amount: string; readonly note: string; readonly receiptFileId: string; readonly receiptName: string }[];
  readonly entries: readonly EntryView[];
  readonly invoices: readonly InvoiceRowView[];
  /** Amounts to offer in the new-invoice form, worked out from the budget and what is already invoiced. */
  readonly invoiceForm: { readonly deposit: string; readonly balance: string; readonly full: string };
  readonly invoiceKinds: readonly Option[];
  readonly recurring: readonly RecurringLine[];
  readonly everyOptions: readonly Option[];
  readonly can: { readonly edit: boolean; readonly addExpense: boolean; readonly export: boolean; readonly download: boolean; readonly removeTime: boolean; readonly viewInvoices: boolean; readonly editInvoices: boolean };
  readonly categories: readonly Option[];
  readonly paymentStatuses: readonly Option[];
  readonly today: string;
};

export function projectMoney(deps: FinanceDeps, actorId: Id | null, projectId: Id): Result<ProjectMoneyView, Refused> {
  if (!may(deps, actorId, "finance.view")) return err("forbidden");
  const project = deps.projects.get(projectId);
  if (!project) return err("not-found");
  const today = deps.today();
  const m = measure(deps, project, today);
  const phases = deps.phases.listFor(projectId);
  const estimates = deps.phaseEstimates.forProject(projectId);
  const actuals = deps.time.totalsByPhase(projectId, m.period);
  const phaseRow = (id: Id | null, name: string) => {
    const estimate = estimates.find((one) => one.phaseId === id)?.minutes ?? 0;
    const actual = actuals.find((one) => one.phaseId === id)?.minutes ?? 0;
    return { key: id ?? "none", name, estimate: estimate > 0 ? readableHours(estimate) : "", actual: readableHours(actual), over: estimate > 0 && actual > estimate };
  };
  const rows = [...phases.map((phase) => phaseRow(phase.id, phase.name)), phaseRow(null, phases.length > 0 ? "No phase" : "All work")];
  return ok({
    project: { id: project.id, name: project.name, active: project.status === "active" },
    period: m.period.label,
    fromProposal: m.fromProposal,
    summary: summaryOf(m.budget, m.time, m.expenses, m.standing),
    warning: m.warning ? { level: m.warning.level, text: m.warning.text } : null,
    phases: rows.filter((row) => row.estimate !== "" || row.actual !== "0" || row.key !== "none" || phases.length === 0),
    payment: { status: m.finance.paymentStatus, statusLabel: PAYMENT_LABELS[m.finance.paymentStatus] ?? m.finance.paymentStatus, invoiceRef: m.finance.invoiceRef },
    budgetForm: {
      amount: m.finance.budget === null ? "" : (m.finance.budget.minor / 100).toFixed(2),
      hours: m.finance.budgetMinutes === null ? "" : formatHours(m.finance.budgetMinutes),
      rate: (m.finance.rate.minor / 100).toFixed(2),
    },
    expenses: deps.expenses.listForProject(projectId).map((expense) => ({
      id: expense.id,
      on: expense.spentOn,
      categoryLabel: CATEGORY_LABELS[expense.category] ?? expense.category,
      amount: formatMoney(expense.amount),
      note: expense.note,
      receiptFileId: expense.receiptFileId ?? "",
      receiptName: expense.receiptName ?? "",
    })),
    entries: deps.time.listForProject(projectId, 50).map(entryView),
    invoices: may(deps, actorId, "invoice.view") ? deps.invoices.listForProject(projectId).map((invoice) => invoiceRowView(invoice, today)) : [],
    invoiceForm: invoiceSuggestions(m.budget.amount, deps.invoices.listForProject(projectId)),
    invoiceKinds: options(INVOICE_KIND_LABELS),
    recurring: may(deps, actorId, "invoice.view") ? deps.recurring.listForProject(projectId).map((one) => recurringLine(one, project.name, "", today)) : [],
    everyOptions: options(EVERY_LABELS),
    can: {
      viewInvoices: may(deps, actorId, "invoice.view"),
      editInvoices: may(deps, actorId, "invoice.edit"),
      edit: may(deps, actorId, "finance.edit"),
      addExpense: may(deps, actorId, "expense.edit"),
      export: may(deps, actorId, "finance.export"),
      download: may(deps, actorId, "file.download"),
      removeTime: may(deps, actorId, "time.view-all"),
    },
    categories: options(CATEGORY_LABELS),
    paymentStatuses: options(PAYMENT_LABELS),
    today,
  });
}

export type InvoiceRowView = {
  readonly id: string;
  readonly label: string;
  readonly kindLabel: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly total: string;
  readonly paid: string;
  readonly owed: string;
  readonly issuedOn: string;
  readonly dueOn: string;
  /** The same two days as people read them: "Mon, Nov 23". */
  readonly issued: string;
  readonly due: string;
  readonly overdue: boolean;
};

function invoiceRowView(invoice: InvoiceRow, today = "9999-12-31"): InvoiceRowView {
  return {
    id: invoice.id,
    label: invoiceLabel(invoice.number),
    // "Something else" is the form's word for the choice; on a made invoice it reads as what it is.
    kindLabel: invoice.kind === "other" ? "A one-off charge" : (INVOICE_KIND_LABELS[invoice.kind] ?? invoice.kind),
    status: invoice.status,
    statusLabel: invoice.writtenOffOn ? "Written off" : (INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status),
    total: formatMoney(invoice.total),
    paid: formatMoney(usd(invoice.paidMinor)),
    owed: formatMoney(usd(invoice.total.minor - invoice.paidMinor)),
    issuedOn: invoice.issuedOn ?? "",
    dueOn: invoice.dueOn ?? "",
    issued: friendlyDay(invoice.issuedOn ?? "", today === "9999-12-31" ? (invoice.issuedOn ?? "") : today),
    due: friendlyDay(invoice.dueOn ?? "", today === "9999-12-31" ? (invoice.dueOn ?? "") : today),
    overdue: invoice.status === "sent" && invoice.dueOn !== null && invoice.dueOn < today,
  };
}

const plain = (minor: number): string => (minor > 0 ? (minor / 100).toFixed(2) : "");

/** What a deposit, the balance and the full amount would be, from the budget and what is already invoiced. */
function invoiceSuggestions(budget: Money | null, invoices: readonly Invoice[]): { deposit: string; balance: string; full: string } {
  if (budget === null) return { deposit: "", balance: "", full: "" };
  const invoiced = invoices.filter((invoice) => invoice.status !== "void").reduce((sum, invoice) => sum + invoice.total.minor, 0);
  return { deposit: plain(depositShare(budget.minor)), balance: plain(budget.minor - invoiced), full: plain(budget.minor) };
}

export const INVOICE_FILTERS = ["unpaid", "overdue", "drafts", "paid", "void", "all"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];
const FILTER_LABELS: Readonly<Record<InvoiceFilter, string>> = { unpaid: "Waiting for payment", overdue: "Overdue", drafts: "Drafts", paid: "Paid", void: "Voided", all: "All" };

export type InvoicesView = {
  readonly filter: InvoiceFilter;
  readonly filters: readonly { readonly value: InvoiceFilter; readonly label: string; readonly count: number; readonly current: boolean }[];
  readonly items: readonly (InvoiceRowView & { readonly clientName: string; readonly organizationId: string; readonly projectName: string; readonly forWhat: string })[];
  /** Owed on everything sent and not paid, overdue among it, and drafts not sent yet. */
  readonly totals: { readonly owed: string; readonly overdue: string; readonly drafts: string };
  /** Owed, by client, most first: who owes us what. */
  readonly byClient: readonly { readonly organizationId: string; readonly clientName: string; readonly owed: string; readonly overdue: boolean }[];
};

/** Money → Invoices: every invoice, on a project or not, by where it stands. `invoice.view`. */
export function invoicesOverview(deps: FinanceDeps, actorId: Id | null, wanted: string | null): Result<InvoicesView, "forbidden"> {
  if (!may(deps, actorId, "invoice.view")) return err("forbidden");
  const today = deps.today();
  const filter: InvoiceFilter = (INVOICE_FILTERS as readonly string[]).includes(wanted ?? "") ? (wanted as InvoiceFilter) : "unpaid";
  const all = deps.invoices.list().reverse();
  const owedOf = (one: InvoiceRow) => (one.status === "sent" ? Math.max(0, one.total.minor - one.paidMinor) : 0);
  const overdue = (one: InvoiceRow) => one.status === "sent" && one.dueOn !== null && one.dueOn < today;
  const matches: Readonly<Record<InvoiceFilter, (one: InvoiceRow) => boolean>> = {
    unpaid: (one) => one.status === "sent",
    overdue,
    drafts: (one) => one.status === "draft",
    paid: (one) => one.status === "paid",
    void: (one) => one.status === "void",
    all: () => true,
  };
  const byClient = new Map<string, { clientName: string; owed: number; overdue: boolean }>();
  for (const one of all.filter((invoice) => invoice.status === "sent")) {
    const was = byClient.get(one.organizationId) ?? { clientName: one.clientName, owed: 0, overdue: false };
    byClient.set(one.organizationId, { clientName: was.clientName, owed: was.owed + owedOf(one), overdue: was.overdue || overdue(one) });
  }
  const sum = (list: readonly InvoiceRow[], amount: (one: InvoiceRow) => number) => formatMoney(usd(list.reduce((total, one) => total + amount(one), 0)));
  return ok({
    filter,
    filters: INVOICE_FILTERS.map((value) => ({ value, label: FILTER_LABELS[value], count: all.filter(matches[value]).length, current: value === filter })),
    items: all.filter(matches[filter]).map((one) => ({ ...invoiceRowView(one, today), clientName: one.clientName, organizationId: one.organizationId, projectName: one.projectName, forWhat: one.projectName || one.lines[0]?.description || "" })),
    totals: { owed: sum(all, owedOf), overdue: sum(all.filter(overdue), owedOf), drafts: sum(all.filter((one) => one.status === "draft"), (one) => one.total.minor) },
    byClient: [...byClient]
      .filter(([, one]) => one.owed > 0)
      .sort(([, a], [, b]) => b.owed - a.owed)
      .map(([organizationId, one]) => ({ organizationId, clientName: one.clientName, owed: formatMoney(usd(one.owed)), overdue: one.overdue })),
  });
}

/** A client's invoices, on a project or not, and whether this person may bill them for a one-off charge. `invoice.view`. */
export type ClientInvoicesView = {
  readonly items: readonly (InvoiceRowView & { readonly projectName: string })[];
  readonly canCreate: boolean;
  readonly kinds: readonly Option[];
  /** The money line at the top of a client's page. */
  readonly money: { readonly owed: string; readonly overdue: string; readonly hasOverdue: boolean; readonly paidThisYear: string; readonly owedMinor: number };
  /** Prepaid hours: what's left, and each block bought. Null when they've bought none. */
  readonly prepaid: { readonly bought: string; readonly used: string; readonly left: string; readonly low: boolean; readonly over: boolean; readonly blocks: readonly { readonly id: string; readonly hours: string; readonly boughtOn: string; readonly note: string; readonly invoiceId: string }[] } | null;
  /** Recurring invoices on the client with no project: hosting, upkeep, a plan. */
  readonly plans: readonly RecurringLine[];
  readonly everyOptions: readonly Option[];
  readonly today: string;
};

export function clientInvoices(deps: FinanceDeps, actorId: Id | null, organizationId: Id): Result<ClientInvoicesView, "forbidden"> {
  if (!may(deps, actorId, "invoice.view")) return err("forbidden");
  const today = deps.today();
  const invoices = deps.invoices.listForClient(organizationId);
  const owed = (one: InvoiceRow) => (one.status === "sent" ? Math.max(0, one.total.minor - one.paidMinor) : 0);
  const late = invoices.filter((one) => one.status === "sent" && one.dueOn !== null && one.dueOn < today);
  const year = Number(today.slice(0, 4));
  const paidThisYear = deps.billing.paymentsForClient(organizationId, year).reduce((sum, one) => sum + one.payment.amount.minor, 0);
  const blocks = deps.billing.blocksFor(organizationId);
  const balance = prepaidBalance(blocks, blocks.length > 0 ? deps.billing.minutesSince(organizationId, [...blocks].map((one) => one.boughtOn).sort()[0] as string) : 0);
  const clientName = deps.clients.get(organizationId)?.name ?? "";
  return ok({
    items: invoices.map((invoice) => ({ ...invoiceRowView(invoice, today), projectName: invoice.projectName, forWhat: invoice.projectName || invoice.lines[0]?.description || "No project" })),
    canCreate: may(deps, actorId, "invoice.edit"),
    // Without a project, an invoice is for the full amount of something, or another charge.
    kinds: options(INVOICE_KIND_LABELS).filter((one) => one.value === "other" || one.value === "full"),
    money: {
      owed: formatMoney(usd(invoices.reduce((sum, one) => sum + owed(one), 0))),
      overdue: formatMoney(usd(late.reduce((sum, one) => sum + owed(one), 0))),
      hasOverdue: late.length > 0,
      paidThisYear: formatMoney(usd(paidThisYear)),
      owedMinor: invoices.reduce((sum, one) => sum + owed(one), 0),
    },
    prepaid:
      blocks.length === 0
        ? null
        : {
            bought: readableHours(balance.boughtMinutes),
            used: readableHours(balance.usedMinutes),
            left: balance.leftMinutes < 0 ? `${readableHours(-balance.leftMinutes)} over` : readableHours(balance.leftMinutes),
            low: balance.low,
            over: balance.leftMinutes < 0,
            blocks: blocks.map((one) => ({ id: one.id, hours: readableHours(one.minutes), boughtOn: friendlyDay(one.boughtOn, today), note: one.note, invoiceId: one.invoiceId ?? "" })),
          },
    plans: deps.recurring.listForClientAlone(organizationId).map((one) => recurringLine(one, "", clientName, today)),
    everyOptions: options(EVERY_LABELS),
    today,
  });
}

export type InvoiceView = {
  readonly invoice: InvoiceRowView & { readonly note: string; readonly draft: boolean };
  /** The project it is for, or null for a charge on the client alone. */
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly client: { readonly id: string; readonly name: string };
  readonly clientName: string;
  readonly lines: readonly { readonly key: string; readonly description: string; readonly amount: string }[];
  readonly payments: readonly { readonly id: string; readonly on: string; readonly amount: string; readonly method: string; readonly methodLabel: string; readonly reference: string; readonly refunded: string; readonly refundablePlain: string; readonly refundable: boolean }[];
  /** Money given back on this invoice's payments, oldest first. */
  readonly refunds: readonly { readonly id: string; readonly on: string; readonly amount: string; readonly how: string; readonly reason: string; readonly reference: string }[];
  readonly owedPlain: string;
  readonly can: { readonly refund: boolean; readonly addLine: boolean; readonly send: boolean; readonly void: boolean; readonly pay: boolean; readonly promise: boolean; readonly payLink: boolean; readonly writeOff: boolean };
  /** When the client promised to pay, and what they said. */
  readonly promise: { readonly on: string; readonly when: string; readonly note: string; readonly due: boolean } | null;
  readonly payLink: string;
  readonly writtenOff: { readonly on: string; readonly note: string } | null;
  readonly methods: readonly Option[];
  readonly today: string;
};

export function invoiceDetail(deps: FinanceDeps, actorId: Id | null, invoiceId: Id): Result<InvoiceView, Refused> {
  if (!may(deps, actorId, "invoice.view")) return err("forbidden");
  const invoice = deps.invoices.get(invoiceId);
  if (!invoice) return err("not-found");
  const today = deps.today();
  const edit = may(deps, actorId, "invoice.edit");
  const refunds = deps.invoices.refunds(invoiceId);
  return ok({
    invoice: { ...invoiceRowView(invoice, today), note: invoice.note, draft: invoice.status === "draft" },
    project: invoice.projectId === null ? null : { id: invoice.projectId, name: invoice.projectName },
    client: { id: invoice.organizationId, name: invoice.clientName },
    clientName: invoice.clientName,
    lines: invoice.lines.map((line, index) => ({ key: String(index), description: line.description, amount: formatMoney(line.amount) })),
    payments: deps.invoices.payments(invoiceId).map((payment) => {
      const back = refunds.filter((one) => one.paymentId === payment.id).reduce((sum, one) => sum + one.amount.minor, 0);
      const left = payment.amount.minor - back;
      return { id: payment.id, on: friendlyDay(payment.receivedOn, today), amount: formatMoney(payment.amount), method: payment.method, methodLabel: METHOD_LABELS[payment.method] ?? payment.method, reference: payment.reference, refunded: back > 0 ? `${formatMoney({ minor: back, currency: payment.amount.currency })} refunded` : "", refundablePlain: plain(left), refundable: left > 0 };
    }),
    refunds: refunds.map((one) => ({ id: one.id, on: friendlyDay(one.refundedOn, today), amount: formatMoney(one.amount), how: one.through === "platform" ? "Through the payment platform" : "By hand", reason: one.reason, reference: one.reference })),
    owedPlain: plain(invoice.total.minor - invoice.paidMinor),
    can: {
      refund: may(deps, actorId, "payment.record"),
      addLine: edit && invoice.status === "draft",
      send: edit && invoice.status === "draft",
      void: edit && (invoice.status === "draft" || invoice.status === "sent") && invoice.paidMinor === 0,
      pay: invoice.status === "sent" && may(deps, actorId, "payment.record"),
      promise: edit && invoice.status === "sent",
      payLink: edit && (invoice.status === "draft" || invoice.status === "sent"),
      writeOff: edit && invoice.status === "sent",
    },
    promise: invoice.promisedOn ? { on: invoice.promisedOn, when: friendlyDay(invoice.promisedOn, today), note: invoice.promiseNote, due: invoice.status === "sent" && invoice.promisedOn <= today } : null,
    payLink: invoice.payLink ?? "",
    writtenOff: invoice.writtenOffOn ? { on: friendlyDay(invoice.writtenOffOn, today), note: invoice.writtenOffNote } : null,
    methods: options(METHOD_LABELS),
    today,
  });
}

/** An invoice laid out for the PDF. */
export type InvoiceDocument = {
  readonly label: string;
  readonly clientName: string;
  readonly projectName: string;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly lines: readonly { readonly description: string; readonly amount: string }[];
  readonly total: string;
  readonly paid: string;
  readonly owed: string;
  readonly note: string;
  readonly fileName: string;
};

export function documentForInvoice(invoice: InvoiceRow): InvoiceDocument {
  const view = invoiceRowView(invoice);
  return {
    label: view.label,
    clientName: invoice.clientName,
    projectName: invoice.projectName,
    issuedOn: view.issuedOn,
    dueOn: view.dueOn,
    lines: invoice.lines.map((line) => ({ description: line.description, amount: formatMoney(line.amount) })),
    total: view.total,
    paid: invoice.paidMinor > 0 ? view.paid : "",
    owed: view.owed,
    note: invoice.note,
    fileName: `${view.label}.pdf`,
  };
}

/** A sent or paid invoice as a document. A draft has no PDF: it is not an invoice yet. */
export function invoiceDocument(deps: FinanceDeps, actorId: Id | null, invoiceId: Id): Result<InvoiceDocument, Refused> {
  if (!may(deps, actorId, "invoice.view")) return err("forbidden");
  const invoice = deps.invoices.get(invoiceId);
  if (!invoice || invoice.status === "draft" || invoice.status === "void") return err("not-found");
  return ok(documentForInvoice(invoice));
}

export type RecurringLine = {
  readonly id: string;
  /** "" for one on the client alone. */
  readonly projectId: string;
  readonly organizationId: string;
  readonly projectName: string;
  readonly clientName: string;
  readonly description: string;
  readonly amount: string;
  readonly everyLabel: string;
  readonly next: string;
  readonly nextOn: string;
  readonly endsText: string;
  readonly autoSend: boolean;
  readonly active: boolean;
  readonly monthly: string;
};

function recurringLine(one: RecurringInvoice, projectName: string, clientName: string, today: string): RecurringLine {
  return {
    id: one.id,
    projectId: one.projectId ?? "",
    organizationId: one.organizationId,
    projectName,
    clientName,
    description: one.description,
    amount: formatMoney(one.amount),
    everyLabel: EVERY_LABELS[one.every],
    next: friendlyDay(one.nextOn, today),
    nextOn: one.nextOn,
    endsText: one.endsOn ? `until ${friendlyDay(one.endsOn, today)}` : "",
    autoSend: one.autoSend,
    active: one.active,
    monthly: formatMoney(usd(monthlyMinor(one))),
  };
}

export type RecurringOverviewView = { readonly items: readonly RecurringLine[]; readonly monthly: string; readonly yearly: string };

/** Every active recurring invoice, and what they bring in a month and a year. Permission: `invoice.view`. */
export function recurringOverview(deps: FinanceDeps, actorId: Id | null): Result<RecurringOverviewView, "forbidden"> {
  if (!may(deps, actorId, "invoice.view")) return err("forbidden");
  const projects = new Map(deps.projects.list().map((project) => [project.id as string, project]));
  const active = deps.recurring.listActive();
  const today = deps.today();
  const monthly = active.reduce((sum, one) => sum + monthlyMinor(one), 0);
  return ok({
    items: active.map((one) => {
      const project = one.projectId === null ? null : projects.get(one.projectId);
      return recurringLine(one, one.projectId === null ? "" : (project?.name ?? "A removed project"), project?.clientName ?? deps.clients.get(one.organizationId)?.name ?? "", today);
    }),
    monthly: formatMoney(usd(monthly)),
    yearly: formatMoney(usd(monthly * 12)),
  });
}

export type FinanceOverviewView = {
  readonly rows: readonly {
    readonly id: string;
    readonly name: string;
    readonly clientName: string;
    readonly active: boolean;
    readonly period: string;
    readonly hours: MoneyLine;
    readonly cost: MoneyLine;
    readonly margin: string;
    readonly marginPercent: string;
    readonly marginNegative: boolean;
    readonly paymentLabel: string;
    readonly over: boolean;
    /** Active, and three quarters used ahead of the work. */
    readonly watch: boolean;
  }[];
  readonly totals: { readonly budget: string; readonly cost: string; readonly margin: string };
  readonly canExport: boolean;
};

/** Every project's budget against actual, with a revenue and margin summary. */
export function financeOverview(deps: FinanceDeps, actorId: Id | null): Result<FinanceOverviewView, "forbidden"> {
  if (!may(deps, actorId, "finance.view")) return err("forbidden");
  const today = deps.today();
  let budget = 0;
  let cost = 0;
  const rows = deps.projects
    .list()
    // Demo clients' projects aren't real work: they stay off Money and the reports.
    .filter((project) => project.status !== "cancelled" && !project.demo)
    .map((project) => {
      const m = measure(deps, project, today);
      const s = summaryOf(m.budget, m.time, m.expenses, m.standing);
      budget += m.budget.amount?.minor ?? 0;
      cost += m.standing.cost.minor;
      return {
        id: project.id,
        name: project.name,
        clientName: project.clientName,
        active: project.status === "active",
        period: m.period.label,
        hours: s.hours,
        cost: s.cost,
        margin: s.margin,
        marginPercent: s.marginPercent,
        marginNegative: s.marginNegative,
        paymentLabel: PAYMENT_LABELS[m.finance.paymentStatus] ?? m.finance.paymentStatus,
        over: s.over,
        watch: project.status === "active" && m.warning?.level === "watch",
      };
    });
  return ok({ rows, totals: { budget: formatMoney(usd(budget)), cost: formatMoney(usd(cost)), margin: formatMoney(usd(budget - cost)) }, canExport: may(deps, actorId, "finance.export") });
}

export type OverBudgetView = { readonly items: readonly { readonly id: string; readonly name: string; readonly clientName: string; readonly why: string; readonly level: BudgetWarning["level"]; readonly warning: string }[] };

/**
 * The dashboard's panel: active projects past their hours or their budget,
 * then those worth watching (see `budgetWarning`).
 */
export function projectsOverBudget(deps: FinanceDeps, actorId: Id | null): Result<OverBudgetView, "forbidden"> {
  if (!may(deps, actorId, "finance.view")) return err("forbidden");
  const today = deps.today();
  const items = [];
  for (const project of deps.projects.list().filter((one) => one.status === "active")) {
    const m = measure(deps, project, today);
    if (!m.warning) continue;
    const parts = [];
    if (m.budget.minutes !== null) parts.push(`${formatHours(m.time.minutes)} of ${formatHours(m.budget.minutes)} hours`);
    if (m.budget.amount !== null) parts.push(`${formatMoney(m.standing.cost)} of ${formatMoney(m.budget.amount)}`);
    items.push({ id: project.id, name: project.name, clientName: project.clientName, why: `${parts.join(", ")} ${m.period.label}`, level: m.warning.level, warning: m.warning.text });
  }
  return ok({ items: [...items.filter((one) => one.level === "over"), ...items.filter((one) => one.level === "watch")] });
}

export type CsvFile = { readonly fileName: string; readonly csv: string };
export type FinanceTable = { readonly header: readonly string[]; readonly rows: readonly (readonly Cell[])[] };
export const FINANCE_TABLES = ["time", "expenses", "projects", "invoices", "payments", "profit"] as const;
const ALL_TIME = { from: "0000-01-01", to: "9999-12-31" };

/** One of the three finance tables, as the CSV exports and the Google Sheet both show it. Null for an unknown name. */
function profitSources(deps: FinanceDeps): { invoiced: Dated[]; received: Dated[]; spent: Spent[] } {
  return {
    invoiced: deps.invoices
      .list()
      .filter((one) => (one.status === "sent" || one.status === "paid") && one.issuedOn)
      .map((one) => ({ on: one.issuedOn as string, minor: one.total.minor })),
    received: deps.invoices.allPayments().map((one) => ({ on: one.receivedOn, minor: one.amount.minor })),
    spent: deps.expenses.list(ALL_TIME).map((one) => ({ on: one.spentOn, minor: one.amount.minor, category: one.category })),
  };
}

export type ProfitView = {
  readonly year: number;
  readonly years: readonly number[];
  readonly months: readonly { readonly month: string; readonly label: string; readonly invoiced: string; readonly received: string; readonly spent: string; readonly net: string; readonly negative: boolean }[];
  readonly totals: { readonly invoiced: string; readonly received: string; readonly spent: string; readonly net: string; readonly negative: boolean };
  readonly byCategory: readonly { readonly label: string; readonly amount: string; readonly share: string }[];
  readonly canExport: boolean;
};

/**
 * Money in and out by month for a year, on a cash basis: payments received
 * against expenses, with what was invoiced alongside. Up to this month for
 * the current year. Permission: `finance.view`.
 */
export function profitAndLoss(deps: FinanceDeps, actorId: Id | null, wanted?: string | null): Result<ProfitView, "forbidden"> {
  if (!may(deps, actorId, "finance.view")) return err("forbidden");
  const today = deps.today();
  const thisYear = Number(today.slice(0, 4));
  const sources = profitSources(deps);
  const firstYear = Math.min(thisYear, ...[...sources.invoiced, ...sources.received, ...sources.spent].map((row) => Number(row.on.slice(0, 4))));
  const year = /^\d{4}$/.test(wanted ?? "") && Number(wanted) >= firstYear && Number(wanted) <= thisYear ? Number(wanted) : thisYear;
  const table = profitByMonth(sources, `${year}-01`, year === thisYear ? today.slice(0, 7) : `${year}-12`);
  const money = (minor: number) => formatMoney(usd(minor));
  return ok({
    year,
    years: Array.from({ length: thisYear - firstYear + 1 }, (_, n) => thisYear - n),
    months: table.months.map((row) => ({ month: row.month, label: Temporal.PlainYearMonth.from(row.month).toPlainDate({ day: 1 }).toLocaleString("en-US", { month: "long" }), invoiced: money(row.invoiced), received: money(row.received), spent: money(row.spent), net: money(row.net), negative: row.net < 0 })),
    totals: { invoiced: money(table.totals.invoiced), received: money(table.totals.received), spent: money(table.totals.spent), net: money(table.totals.net), negative: table.totals.net < 0 },
    byCategory: table.byCategory.map((one) => ({ label: CATEGORY_LABELS[one.category] ?? one.category, amount: money(one.minor), share: table.totals.spent > 0 ? `${Math.round((one.minor / table.totals.spent) * 100)}%` : "" })),
    canExport: may(deps, actorId, "finance.export"),
  });
}

export function financeTable(deps: FinanceDeps, what: string, today: string): FinanceTable | null {
  if (what === "time") {
    return {
      header: ["Date", "Client", "Project", "Task", "Person", "Hours", "Minutes", "Billable", "Note"],
      rows: deps.time
        .list(ALL_TIME, null)
        .filter((entry) => entry.minutes !== null)
        .map((e) => [e.workedOn, e.clientName, e.projectName, e.taskTitle ?? "", e.userName, Number(((e.minutes ?? 0) / 60).toFixed(2)), e.minutes, e.billable ? "yes" : "no", e.note]),
    };
  }
  if (what === "expenses") {
    return {
      header: ["Date", "Client", "Project", "Category", "Amount", "Currency", "Note", "Receipt", "Recorded by"],
      rows: deps.expenses.list(ALL_TIME).map((e) => [e.spentOn, e.clientName, e.projectName, CATEGORY_LABELS[e.category] ?? e.category, e.amount.minor / 100, e.amount.currency, e.note, e.receiptName ?? "", e.recordedByName]),
    };
  }
  if (what === "projects") {
    return {
      header: ["Client", "Project", "Status", "Measured", "Budget", "Budget hours", "Hours", "Billable hours", "Time cost", "Expenses", "Cost", "Margin (estimate)", "Payment", "Invoice"],
      rows: deps.projects.list().map((project) => {
        const m = measure(deps, project, today);
        return [
          project.clientName,
          project.name,
          project.status,
          m.period.label,
          m.budget.amount === null ? null : m.budget.amount.minor / 100,
          m.budget.minutes === null ? null : Number((m.budget.minutes / 60).toFixed(2)),
          Number((m.time.minutes / 60).toFixed(2)),
          Number((m.time.billableMinutes / 60).toFixed(2)),
          m.standing.timeCost.minor / 100,
          m.expenses.minor / 100,
          m.standing.cost.minor / 100,
          m.standing.margin === null ? null : m.standing.margin.minor / 100,
          PAYMENT_LABELS[m.finance.paymentStatus] ?? m.finance.paymentStatus,
          m.finance.invoiceRef,
        ];
      }),
    };
  }
  if (what === "invoices") {
    return {
      header: ["Number", "Client", "Project", "For", "Status", "Issued", "Due", "Total", "Received", "Owed"],
      rows: deps.invoices
        .list()
        .map((i) => [invoiceLabel(i.number), i.clientName, i.projectName, INVOICE_KIND_LABELS[i.kind] ?? i.kind, i.status, i.issuedOn ?? "", i.dueOn ?? "", i.total.minor / 100, i.paidMinor / 100, i.status === "void" ? 0 : (i.total.minor - i.paidMinor) / 100]),
    };
  }
  if (what === "profit") {
    const sources = profitSources(deps);
    const first = [...sources.invoiced, ...sources.received, ...sources.spent].map((row) => row.on.slice(0, 7)).toSorted()[0] ?? today.slice(0, 7);
    const table = profitByMonth(sources, first, today.slice(0, 7));
    return {
      header: ["Month", "Invoiced", "Received", "Spent", "Received less spent"],
      rows: table.months.map((row) => [row.month, row.invoiced / 100, row.received / 100, row.spent / 100, row.net / 100]),
    };
  }
  if (what === "payments") {
    return {
      header: ["Received", "Invoice", "Client", "Project", "Amount", "Currency", "Method", "Reference"],
      rows: deps.invoices.allPayments().map((p) => [p.receivedOn, invoiceLabel(p.number), p.clientName, p.projectName, p.amount.minor / 100, p.amount.currency, METHOD_LABELS[p.method] ?? p.method, p.reference]),
    };
  }
  return null;
}

/**
 * CSV exports of time, expenses, and the per-project summary (roadmap v0.5).
 * Records leave HQ here, so each export is written to the audit log.
 */
export function exportFinance(deps: FinanceDeps, actorId: Id | null, what: string): Result<CsvFile, "forbidden" | "not-found"> {
  if (actorId === null || !may(deps, actorId, "finance.export")) return err("forbidden");
  const today = deps.today();
  const table = financeTable(deps, what, today);
  if (!table) return err("not-found");
  deps.transact(() => {
    recordActivity(deps, { actorId, action: "finance.exported", recordType: "export", recordId: deps.newId(), context: { what, rows: table.rows.length } });
  });
  return ok({ fileName: `hq-${what}-${today}.csv`, csv: toCsv(table.header, table.rows) });
}

/**
 * Somewhere the finance tables are copied to: the Google Sheet, which is the
 * book of record for taxes (docs/tool-boundaries.md, rule 2). The copy runs
 * one way. HQ never reads the sheet back.
 */
export type SheetTarget = {
  readonly describe: string;
  /** Replaces the whole content of each named tab. */
  replace(tabs: readonly { readonly name: string; readonly rows: readonly (readonly Cell[])[] }[]): Promise<void>;
};

/**
 * Copies the finance tables to tabs of their own in the sheet, replacing what
 * those tabs held. The tabs are named "HQ Time", "HQ Expenses" and so on, so
 * nothing Mikey keeps in the sheet himself is ever touched. HQ does this by
 * itself each night, so the event has no actor.
 */
export async function syncFinanceSheet(deps: FinanceDeps, target: SheetTarget): Promise<{ readonly rows: number }> {
  const today = deps.today();
  const tabs = FINANCE_TABLES.map((what) => {
    const table = financeTable(deps, what, today) as FinanceTable;
    return { name: `HQ ${what.charAt(0).toUpperCase()}${what.slice(1)}`, rows: [table.header, ...table.rows] };
  });
  const rows = tabs.reduce((sum, tab) => sum + tab.rows.length - 1, 0);
  try {
    await target.replace(tabs);
  } catch (error) {
    deps.transact(() => {
      recordActivity(deps, { actorId: null, action: "finance.sheet-sync-failed", recordType: "export", recordId: deps.newId(), context: { reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" } });
    });
    throw error;
  }
  deps.transact(() => {
    recordActivity(deps, { actorId: null, action: "finance.sheet-synced", recordType: "export", recordId: deps.newId(), context: { rows } });
  });
  return { rows };
}

/** What money asks of Potomac's people on Today: payments promised for today or before, still owed. `invoice.view`. */
export type MoneyFollowUp = { readonly key: string; readonly text: string; readonly detail: string; readonly href: string; readonly action: string; readonly overdue: boolean; readonly at: string };

export function moneyFollowUps(deps: FinanceDeps, actorId: Id | null): readonly MoneyFollowUp[] {
  if (!may(deps, actorId, "invoice.view")) return [];
  const today = deps.today();
  const low = deps.billing.clientsWithBlocks().flatMap((organizationId): MoneyFollowUp[] => {
    const blocks = deps.billing.blocksFor(organizationId);
    const balance = prepaidBalance(blocks, deps.billing.minutesSince(organizationId, [...blocks].map((one) => one.boughtOn).sort()[0] as string));
    if (!balance.low) return [];
    const name = deps.clients.get(organizationId)?.name ?? "A client";
    const left = balance.leftMinutes < 0 ? `${readableHours(-balance.leftMinutes)} over` : `${readableHours(balance.leftMinutes)} left`;
    return [{ key: `prepaid-${organizationId}`, text: `${name}’s prepaid hours are running low`, detail: `${left} of ${readableHours(balance.boughtMinutes)} bought`, href: `/clients/${organizationId}#billing`, action: "Open", overdue: balance.leftMinutes < 0, at: today }];
  });
  return [...low, ...deps.invoices
    .list()
    .filter((one) => one.status === "sent" && one.promisedOn !== null && one.promisedOn <= today)
    .map((one) => ({
      key: `promise-${one.id}`,
      text: `${one.clientName} promised to pay ${invoiceLabel(one.number)}`,
      detail: `${formatMoney(usd(one.total.minor - one.paidMinor))} owed · promised for ${friendlyDay(one.promisedOn as string, today)}${one.promiseNote ? ` · “${one.promiseNote}”` : ""}`,
      href: `/invoices/${one.id}#follow-up`,
      action: "Follow up",
      overdue: (one.promisedOn as string) < today,
      at: one.promisedOn as string,
    }))];
}

/** How clients pay, in Potomac's words, and whether this person may change it. `invoice.view`. */
export function payInstructionsView(deps: FinanceDeps, actorId: Id | null): { readonly text: string; readonly canEdit: boolean } | null {
  if (!may(deps, actorId, "invoice.view")) return null;
  return { text: deps.billing.payInstructions(), canEdit: may(deps, actorId, "invoice.edit") };
}

/** The cash forecast looks this many weeks ahead, from the Monday of this week. */
export const FORECAST_WEEKS = 13;

export type ForecastItem = { readonly key: string; readonly on: string; readonly label: string; readonly amount: string; readonly kind: "invoice" | "overdue" | "renewal" | "recurring" | "cost"; readonly href: string };
export type ForecastWeek = { readonly start: string; readonly label: string; readonly coming: string; readonly going: string; readonly net: string; readonly running: string; readonly negative: boolean; readonly items: readonly ForecastItem[] };
export type ForecastView = { readonly weeks: readonly ForecastWeek[]; readonly totals: { readonly coming: string; readonly going: string; readonly net: string; readonly overdue: string }; readonly drafts: string };

/**
 * Money → Cash forecast: the next 13 weeks, week by week. Coming in: sent
 * invoices by their due day (overdue ones in this week), renewals not billed
 * yet by their pay-by day, and recurring invoices as they'll be made. Going
 * out: what renewals cost Potomac on the day they renew. Expenses aren't
 * planned in HQ, so they aren't here; drafts are shown apart. `finance.view`.
 */
export function cashForecast(deps: FinanceDeps, actorId: Id | null): Result<ForecastView, "forbidden"> {
  if (!may(deps, actorId, "finance.view")) return err("forbidden");
  const today = Temporal.PlainDate.from(deps.today());
  const first = today.subtract({ days: today.dayOfWeek - 1 });
  const last = first.add({ weeks: FORECAST_WEEKS }).subtract({ days: 1 });
  const from = today.toString();
  const to = last.toString();
  const entries: { readonly on: string; readonly inMinor: number; readonly outMinor: number; readonly item: Omit<ForecastItem, "amount"> }[] = [];
  const invoices = deps.invoices.list();
  for (const one of invoices) {
    if (one.status !== "sent") continue;
    const owed = one.total.minor - one.paidMinor;
    if (owed <= 0) continue;
    const due = one.dueOn ?? from;
    if (due > to) continue;
    const late = due < from;
    entries.push({ on: late ? from : due, inMinor: owed, outMinor: 0, item: { key: `i-${one.id}`, on: due, label: `${invoiceLabel(one.number)}, ${one.clientName}${late ? " (overdue)" : ""}`, kind: late ? "overdue" : "invoice", href: `/invoices/${one.id}` } });
  }
  for (const plan of deps.recurring.listActive()) {
    let on = plan.nextOn;
    for (let n = 0; n < 60 && on <= to && (plan.endsOn === null || on <= plan.endsOn); n++) {
      const due = Temporal.PlainDate.from(on).add({ days: plan.dueDays }).toString();
      if (due >= from && due <= to) {
        const who = deps.clients.get(plan.organizationId)?.name ?? "";
        entries.push({ on: due, inMinor: plan.amount.minor, outMinor: 0, item: { key: `r-${plan.id}-${on}`, on: due, label: `${plan.description}, ${who}`, kind: "recurring", href: plan.projectId ? `/projects/${plan.projectId}/money#recurring` : `/clients/${plan.organizationId}#billing` } });
      }
      on = nextAfter(on, plan.every, plan.anchorDay);
    }
  }
  for (const line of deps.cashflow ? deps.cashflow(from, to) : []) {
    entries.push({ on: line.on, inMinor: line.inMinor, outMinor: line.outMinor, item: { key: `n-${line.label}-${line.on}`, on: line.on, label: line.label, kind: line.outMinor > 0 ? "cost" : "renewal", href: `/clients/${line.organizationId}#renewals` } });
  }
  let running = 0;
  const weeks: ForecastWeek[] = [];
  for (let w = 0; w < FORECAST_WEEKS; w++) {
    const start = first.add({ weeks: w });
    const end = start.add({ days: 6 }).toString();
    const inWeek = entries.filter((one) => one.on >= start.toString() && one.on <= end).sort((a, b) => a.on.localeCompare(b.on));
    const coming = inWeek.reduce((sum, one) => sum + one.inMinor, 0);
    const going = inWeek.reduce((sum, one) => sum + one.outMinor, 0);
    running += coming - going;
    weeks.push({
      start: start.toString(),
      label: `${w === 0 ? "This week" : w === 1 ? "Next week" : "Week of"} ${start.toLocaleString("en-US", { month: "short", day: "numeric" })}`,
      coming: formatMoney(usd(coming)),
      going: formatMoney(usd(going)),
      net: coming - going < 0 ? `−${formatMoney(usd(going - coming))}` : formatMoney(usd(coming - going)),
      running: running < 0 ? `−${formatMoney(usd(-running))}` : formatMoney(usd(running)),
      negative: coming - going < 0,
      items: inWeek.map((one) => ({ ...one.item, amount: formatMoney(usd(one.inMinor > 0 ? one.inMinor : one.outMinor)) })),
    });
  }
  const coming = entries.reduce((sum, one) => sum + one.inMinor, 0);
  const going = entries.reduce((sum, one) => sum + one.outMinor, 0);
  const overdue = entries.filter((one) => one.item.kind === "overdue").reduce((sum, one) => sum + one.inMinor, 0);
  const drafts = invoices.filter((one) => one.status === "draft").reduce((sum, one) => sum + one.total.minor, 0);
  return ok({
    weeks,
    totals: { coming: formatMoney(usd(coming)), going: formatMoney(usd(going)), net: coming - going < 0 ? `−${formatMoney(usd(going - coming))}` : formatMoney(usd(coming - going)), overdue: formatMoney(usd(overdue)) },
    drafts: formatMoney(usd(drafts)),
  });
}

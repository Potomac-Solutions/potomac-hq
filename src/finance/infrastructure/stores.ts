import type { BillingStore, ChangeRequestStore, ExpenseRow, ExpenseStore, FinanceStore, InvoiceRow, InvoiceStore, PhaseEstimates, RecurringStore, ReminderStore, TimeRow, TimeStore } from "../application/ports.ts";
import type { ChangeRequest, ChangeStatus } from "../domain/change-request.ts";
import type { PaymentStatus, ProjectFinance } from "../domain/budget.ts";
import type { Expense, ExpenseCategory } from "../domain/expense.ts";
import type { Invoice, InvoiceKind, InvoiceLine, InvoiceStatus, Payment, PaymentMethod, Refund } from "../domain/invoice.ts";
import type { Every, RecurringInvoice } from "../domain/recurring.ts";
import type { ReminderKind } from "../domain/reminders.ts";
import type { TimeEntry } from "../domain/time.ts";
import type { PrepaidBlock } from "../domain/prepaid.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Currency, Id } from "../../shared/index.ts";

type Row = Record<string, string | number | null>;
const text = (row: Row, key: string) => row[key] as string;
const maybe = (row: Row, key: string) => (row[key] ?? null) as string | null;

const toEntry = (r: Row): TimeEntry => ({
  id: text(r, "id") as Id,
  projectId: text(r, "project_id") as Id,
  taskId: maybe(r, "task_id") as Id | null,
  userId: text(r, "user_id") as Id,
  workedOn: text(r, "worked_on"),
  minutes: (r["minutes"] ?? null) as number | null,
  note: text(r, "note"),
  billable: r["billable"] === 1,
  startedAt: maybe(r, "started_at"),
});

export function sqliteTimeStore(db: Database): TimeStore {
  const cols = "id, project_id, task_id, user_id, worked_on, minutes, note, billable, started_at";
  const insert = db.prepare(`insert into time_entry (${cols}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update time_entry set worked_on = ?, minutes = ?, note = ?, billable = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${cols} from time_entry where id = ? and removed_at is null`);
  const remove = db.prepare("update time_entry set removed_at = ?, updated_at = ? where id = ? and removed_at is null");
  const joined = `select ${cols.split(", ").map((c) => `t.${c}`).join(", ")}, p.name as project_name, k.title as task_title, u.name as user_name, c.name as client_name
       from time_entry t
       join project p on p.id = t.project_id
       join client_organization c on c.id = p.organization_id
       join user u on u.id = t.user_id
       left join task k on k.id = t.task_id
      where t.removed_at is null`;
  const running = db.prepare(`${joined} and t.user_id = ? and t.minutes is null`);
  const runningOnTask = db.prepare(`select ${cols} from time_entry where task_id = ? and minutes is null and removed_at is null`);
  const listMine = db.prepare(`${joined} and t.worked_on between ? and ? and t.user_id = ? order by t.worked_on desc, t.rowid desc`);
  const listAll = db.prepare(`${joined} and t.worked_on between ? and ? order by t.worked_on desc, t.rowid desc`);
  const listForProject = db.prepare(`${joined} and t.project_id = ? order by t.worked_on desc, t.rowid desc limit ?`);
  const totals = db.prepare(
    `select coalesce(sum(minutes), 0) as minutes, coalesce(sum(case when billable = 1 then minutes else 0 end), 0) as billable
       from time_entry where project_id = ? and removed_at is null and minutes is not null and worked_on between ? and ?`,
  );
  const byPhase = db.prepare(
    `select k.phase_id as phase_id, coalesce(sum(t.minutes), 0) as minutes
       from time_entry t left join task k on k.id = t.task_id
      where t.project_id = ? and t.removed_at is null and t.minutes is not null and t.worked_on between ? and ?
      group by k.phase_id`,
  );
  const onTask = db.prepare("select coalesce(sum(minutes), 0) as minutes from time_entry where task_id = ? and removed_at is null and minutes is not null");
  const row = (r: Row): TimeRow => ({ ...toEntry(r), projectName: text(r, "project_name"), taskTitle: maybe(r, "task_title"), userName: text(r, "user_name"), clientName: text(r, "client_name") });
  return {
    insert(e, at) {
      insert.run(e.id, e.projectId, e.taskId, e.userId, e.workedOn, e.minutes, e.note, e.billable ? 1 : 0, e.startedAt, at, at);
    },
    update(e, at) {
      update.run(e.workedOn, e.minutes, e.note, e.billable ? 1 : 0, at, e.id);
    },
    get(id) {
      const r = get.get(id) as Row | undefined;
      return r ? toEntry(r) : null;
    },
    remove(id, at) {
      remove.run(at, at, id);
    },
    running(userId) {
      const r = running.get(userId) as Row | undefined;
      return r ? row(r) : null;
    },
    runningOnTask(taskId) {
      return (runningOnTask.all(taskId) as Row[]).map(toEntry);
    },
    list(range, userId) {
      return ((userId ? listMine.all(range.from, range.to, userId) : listAll.all(range.from, range.to)) as Row[]).map(row);
    },
    listForProject(projectId, limit) {
      return (listForProject.all(projectId, limit) as Row[]).map(row);
    },
    totals(projectId, range) {
      const r = totals.get(projectId, range.from, range.to) as Row;
      return { minutes: r["minutes"] as number, billableMinutes: r["billable"] as number };
    },
    totalsByPhase(projectId, range) {
      return (byPhase.all(projectId, range.from, range.to) as Row[]).map((r) => ({ phaseId: maybe(r, "phase_id") as Id | null, minutes: r["minutes"] as number }));
    },
    minutesOnTask(taskId) {
      return (onTask.get(taskId) as Row)["minutes"] as number;
    },
  };
}

const toExpense = (r: Row): Expense => ({
  id: text(r, "id") as Id,
  projectId: text(r, "project_id") as Id,
  category: text(r, "category") as ExpenseCategory,
  amount: { minor: r["amount_minor"] as number, currency: text(r, "currency") as Currency },
  spentOn: text(r, "spent_on"),
  note: text(r, "note"),
  receiptFileId: maybe(r, "receipt_file_id") as Id | null,
  recordedBy: text(r, "recorded_by") as Id,
});

export function sqliteExpenseStore(db: Database): ExpenseStore {
  const cols = "id, project_id, category, amount_minor, currency, spent_on, note, receipt_file_id, recorded_by";
  const insert = db.prepare(`insert into expense (${cols}, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const get = db.prepare(`select ${cols} from expense where id = ? and removed_at is null`);
  const remove = db.prepare("update expense set removed_at = ? where id = ? and removed_at is null");
  const joined = `select ${cols.split(", ").map((c) => `e.${c}`).join(", ")}, p.name as project_name, c.name as client_name, f.name as receipt_name, u.name as recorded_by_name
       from expense e
       join project p on p.id = e.project_id
       join client_organization c on c.id = p.organization_id
       join user u on u.id = e.recorded_by
       left join file f on f.id = e.receipt_file_id
      where e.removed_at is null`;
  const listForProject = db.prepare(`${joined} and e.project_id = ? order by e.spent_on desc, e.rowid desc`);
  const list = db.prepare(`${joined} and e.spent_on between ? and ? order by e.spent_on desc, e.rowid desc`);
  const total = db.prepare("select coalesce(sum(amount_minor), 0) as minor from expense where project_id = ? and removed_at is null and spent_on between ? and ?");
  const row = (r: Row): ExpenseRow => ({ ...toExpense(r), projectName: text(r, "project_name"), clientName: text(r, "client_name"), receiptName: maybe(r, "receipt_name"), recordedByName: text(r, "recorded_by_name") });
  return {
    insert(e, at) {
      insert.run(e.id, e.projectId, e.category, e.amount.minor, e.amount.currency, e.spentOn, e.note, e.receiptFileId, e.recordedBy, at);
    },
    get(id) {
      const r = get.get(id) as Row | undefined;
      return r ? toExpense(r) : null;
    },
    remove(id, at) {
      remove.run(at, id);
    },
    listForProject(projectId) {
      return (listForProject.all(projectId) as Row[]).map(row);
    },
    list(range) {
      return (list.all(range.from, range.to) as Row[]).map(row);
    },
    total(projectId, range) {
      return (total.get(projectId, range.from, range.to) as Row)["minor"] as number;
    },
  };
}

export function sqliteFinanceStore(db: Database): FinanceStore {
  const get = db.prepare("select project_id, budget_minor, currency, budget_minutes, rate_minor, payment_status, invoice_ref from project_finance where project_id = ?");
  const save = db.prepare(
    `insert into project_finance (project_id, budget_minor, currency, budget_minutes, rate_minor, payment_status, invoice_ref, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (project_id) do update set budget_minor = excluded.budget_minor, budget_minutes = excluded.budget_minutes, rate_minor = excluded.rate_minor,
       payment_status = excluded.payment_status, invoice_ref = excluded.invoice_ref, updated_at = excluded.updated_at`,
  );
  return {
    get(projectId) {
      const r = get.get(projectId) as Row | undefined;
      if (!r) return null;
      const currency = text(r, "currency") as Currency;
      return {
        projectId: text(r, "project_id") as Id,
        budget: r["budget_minor"] === null ? null : { minor: r["budget_minor"] as number, currency },
        budgetMinutes: (r["budget_minutes"] ?? null) as number | null,
        rate: { minor: r["rate_minor"] as number, currency },
        paymentStatus: text(r, "payment_status") as PaymentStatus,
        invoiceRef: text(r, "invoice_ref"),
      } satisfies ProjectFinance;
    },
    save(f, at) {
      save.run(f.projectId, f.budget?.minor ?? null, f.rate.currency, f.budgetMinutes, f.rate.minor, f.paymentStatus, f.invoiceRef, at);
    },
  };
}

export function sqlitePhaseEstimates(db: Database): PhaseEstimates {
  const select = db.prepare("select phase_id, coalesce(sum(estimate_minutes), 0) as minutes from task where project_id = ? group by phase_id");
  return {
    forProject(projectId) {
      return (select.all(projectId) as Row[]).map((r) => ({ phaseId: maybe(r, "phase_id") as Id | null, minutes: r["minutes"] as number }));
    },
  };
}

const toInvoice = (r: Row): Invoice => ({
  id: text(r, "id") as Id,
  organizationId: text(r, "organization_id") as Id,
  projectId: maybe(r, "project_id") as Id | null,
  number: r["number"] as number,
  kind: text(r, "kind") as InvoiceKind,
  status: text(r, "status") as InvoiceStatus,
  lines: JSON.parse(text(r, "lines")) as InvoiceLine[],
  total: { minor: r["total_minor"] as number, currency: text(r, "currency") as Currency },
  issuedOn: maybe(r, "issued_on"),
  dueOn: maybe(r, "due_on"),
  note: text(r, "note"),
  createdBy: text(r, "created_by") as Id,
  promisedOn: maybe(r, "promised_on"),
  promiseNote: text(r, "promise_note"),
  payLink: maybe(r, "pay_link"),
  writtenOffOn: maybe(r, "written_off_on"),
  writtenOffNote: text(r, "written_off_note"),
});

const toPayment = (r: Row): Payment => ({
  id: text(r, "id") as Id,
  invoiceId: text(r, "invoice_id") as Id,
  amount: { minor: r["amount_minor"] as number, currency: text(r, "currency") as Currency },
  method: text(r, "method") as PaymentMethod,
  receivedOn: text(r, "received_on"),
  reference: text(r, "reference"),
  recordedBy: text(r, "recorded_by") as Id,
});

export function sqliteInvoiceStore(db: Database): InvoiceStore {
  const cols = "id, organization_id, project_id, number, kind, status, lines, total_minor, currency, issued_on, due_on, note, created_by";
  const next = db.prepare("select coalesce(max(number), 0) + 1 as next from invoice");
  const insert = db.prepare(`insert into invoice (${cols}, created_at, updated_at) values (${Array(15).fill("?").join(", ")})`);
  const update = db.prepare("update invoice set status = ?, lines = ?, total_minor = ?, issued_on = ?, due_on = ?, note = ?, promised_on = ?, promise_note = ?, pay_link = ?, written_off_on = ?, written_off_note = ?, updated_at = ? where id = ?");
  const extras = "promised_on, promise_note, pay_link, written_off_on, written_off_note";
  const joined = `select ${`${cols}, ${extras}`.split(", ").map((c) => `i.${c}`).join(", ")}, coalesce(p.name, '') as project_name, c.name as client_name,
            (select coalesce(sum(amount_minor), 0) from payment y where y.invoice_id = i.id)
              - (select coalesce(sum(r.amount_minor), 0) from payment_refund r join payment y on y.id = r.payment_id where y.invoice_id = i.id) as paid_minor
       from invoice i left join project p on p.id = i.project_id join client_organization c on c.id = i.organization_id`;
  const get = db.prepare(`${joined} where i.id = ?`);
  const listForProject = db.prepare(`${joined} where i.project_id = ? order by i.number desc`);
  const list = db.prepare(`${joined} order by i.number`);
  const listForClient = db.prepare(`${joined} where i.organization_id = ? order by i.number desc`);
  const pcols = "id, invoice_id, amount_minor, currency, method, received_on, reference, recorded_by";
  const insertPayment = db.prepare(`insert into payment (${pcols}, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const payments = db.prepare(`select ${pcols} from payment where invoice_id = ? order by rowid`);
  // Refunds count as money going back out: a negative amount on the day it was given back.
  const allPayments = db.prepare(
    `select * from (
       select ${pcols.split(", ").map((c) => `y.${c}`).join(", ")}, i.number as number, coalesce(p.name, '') as project_name, c.name as client_name, y.created_at as at
         from payment y join invoice i on i.id = y.invoice_id left join project p on p.id = i.project_id join client_organization c on c.id = i.organization_id
       union all
       select r.id, y.invoice_id, -r.amount_minor, y.currency, y.method, r.refunded_on, ('Refund' || case when r.reference = '' then '' else ' ' || r.reference end), r.recorded_by, i.number, coalesce(p.name, ''), c.name, r.created_at
         from payment_refund r join payment y on y.id = r.payment_id join invoice i on i.id = y.invoice_id left join project p on p.id = i.project_id join client_organization c on c.id = i.organization_id
     ) order by at, id`,
  );
  const rcols = "id, payment_id, amount_minor, refunded_on, reason, reference, through, recorded_by";
  const insertRefund = db.prepare(`insert into payment_refund (${rcols}, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const refundsFor = db.prepare(`select r.${rcols.split(", ").join(", r.")} from payment_refund r join payment y on y.id = r.payment_id where y.invoice_id = ? order by r.rowid`);
  const paymentById = db.prepare(`select ${pcols} from payment where id = ?`);
  const toRefund = (r: Row): Refund => ({
    id: text(r, "id") as Id,
    paymentId: text(r, "payment_id") as Id,
    amount: { minor: r["amount_minor"] as number, currency: "USD" },
    refundedOn: text(r, "refunded_on"),
    reason: text(r, "reason"),
    reference: text(r, "reference"),
    through: text(r, "through") as Refund["through"],
    recordedBy: text(r, "recorded_by") as Id,
  });
  const row = (r: Row): InvoiceRow => ({ ...toInvoice(r), projectName: text(r, "project_name"), clientName: text(r, "client_name"), paidMinor: r["paid_minor"] as number });
  return {
    nextNumber() {
      return (next.get() as Row)["next"] as number;
    },
    insert(i, at) {
      insert.run(i.id, i.organizationId, i.projectId, i.number, i.kind, i.status, JSON.stringify(i.lines), i.total.minor, i.total.currency, i.issuedOn, i.dueOn, i.note, i.createdBy, at, at);
    },
    update(i, at) {
      update.run(i.status, JSON.stringify(i.lines), i.total.minor, i.issuedOn, i.dueOn, i.note, i.promisedOn, i.promiseNote, i.payLink, i.writtenOffOn, i.writtenOffNote, at, i.id);
    },
    get(id) {
      const r = get.get(id) as Row | undefined;
      return r ? row(r) : null;
    },
    listForProject(projectId) {
      return (listForProject.all(projectId) as Row[]).map(row);
    },
    list() {
      return (list.all() as Row[]).map(row);
    },
    listForClient(organizationId) {
      return (listForClient.all(organizationId) as Row[]).map(row);
    },
    insertPayment(p, at) {
      insertPayment.run(p.id, p.invoiceId, p.amount.minor, p.amount.currency, p.method, p.receivedOn, p.reference, p.recordedBy, at);
    },
    payment(id) {
      const found = paymentById.get(id) as Row | undefined;
      return found ? toPayment(found) : null;
    },
    insertRefund(r, at) {
      insertRefund.run(r.id, r.paymentId, r.amount.minor, r.refundedOn, r.reason, r.reference, r.through, r.recordedBy, at);
    },
    refunds(invoiceId) {
      return (refundsFor.all(invoiceId) as Row[]).map(toRefund);
    },
    payments(invoiceId) {
      return (payments.all(invoiceId) as Row[]).map(toPayment);
    },
    allPayments() {
      return (allPayments.all() as Row[]).map((r) => ({ ...toPayment(r), number: r["number"] as number, projectName: text(r, "project_name"), clientName: text(r, "client_name") }));
    },
  };
}

const RECURRING_COLUMNS = "id, organization_id, project_id, description, amount_minor, every, anchor_day, next_on, ends_on, auto_send, due_days, active, created_by";

function toRecurring(row: Record<string, unknown>): RecurringInvoice {
  return {
    id: row["id"] as Id,
    organizationId: row["organization_id"] as Id,
    projectId: (row["project_id"] as Id | null) ?? null,
    description: String(row["description"]),
    amount: { minor: Number(row["amount_minor"]), currency: "USD" },
    every: row["every"] as Every,
    anchorDay: Number(row["anchor_day"]),
    nextOn: String(row["next_on"]),
    endsOn: (row["ends_on"] as string | null) ?? null,
    autoSend: row["auto_send"] === 1,
    dueDays: Number(row["due_days"]),
    active: row["active"] === 1,
    createdBy: row["created_by"] as Id,
  };
}

export function sqliteRecurringStore(db: Database): RecurringStore {
  const insert = db.prepare(`insert into recurring_invoice (${RECURRING_COLUMNS}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update recurring_invoice set description = ?, amount_minor = ?, every = ?, anchor_day = ?, next_on = ?, ends_on = ?, auto_send = ?, due_days = ?, active = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${RECURRING_COLUMNS} from recurring_invoice where id = ?`);
  const forProject = db.prepare(`select ${RECURRING_COLUMNS} from recurring_invoice where project_id = ? order by active desc, next_on`);
  const active = db.prepare(`select ${RECURRING_COLUMNS} from recurring_invoice where active = 1 order by next_on`);
  const forClient = db.prepare(`select ${RECURRING_COLUMNS} from recurring_invoice where organization_id = ? and project_id is null order by active desc, next_on`);
  const due = db.prepare(`select ${RECURRING_COLUMNS} from recurring_invoice where active = 1 and next_on <= ? and (ends_on is null or next_on <= ends_on) order by next_on`);
  const mark = db.prepare("update invoice set recurring_id = ? where id = ?");
  return {
    insert(r, at) {
      insert.run(r.id, r.organizationId, r.projectId, r.description, r.amount.minor, r.every, r.anchorDay, r.nextOn, r.endsOn, r.autoSend ? 1 : 0, r.dueDays, r.active ? 1 : 0, r.createdBy, at, at);
    },
    update(r, at) {
      update.run(r.description, r.amount.minor, r.every, r.anchorDay, r.nextOn, r.endsOn, r.autoSend ? 1 : 0, r.dueDays, r.active ? 1 : 0, at, r.id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toRecurring(row) : null;
    },
    listForProject: (projectId) => forProject.all(projectId).map(toRecurring),
    listActive: () => active.all().map(toRecurring),
    listForClientAlone: (organizationId) => forClient.all(organizationId).map(toRecurring),
    due: (today) => due.all(today).map(toRecurring),
    markInvoice(invoiceId, recurringId) {
      mark.run(recurringId, invoiceId);
    },
  };
}

export function sqliteReminderStore(db: Database): ReminderStore {
  const on = db.prepare("select reminders_on from finance_setting where id = 1");
  const setOn = db.prepare("insert into finance_setting (id, reminders_on, updated_by, updated_at) values (1, ?, ?, ?) on conflict (id) do update set reminders_on = excluded.reminders_on, updated_by = excluded.updated_by, updated_at = excluded.updated_at");
  const sent = db.prepare("select kind, sent_at, sent_to from invoice_reminder where invoice_id = ? order by sent_at");
  const record = db.prepare("insert into invoice_reminder (invoice_id, kind, sent_at, sent_to) values (?, ?, ?, ?) on conflict do nothing");
  const isOff = db.prepare("select 1 from invoice_reminder_off where invoice_id = ?");
  const setOff = db.prepare("insert into invoice_reminder_off (invoice_id, set_by, set_at) values (?, ?, ?) on conflict do nothing");
  const clearOff = db.prepare("delete from invoice_reminder_off where invoice_id = ?");
  return {
    on: () => on.get()?.["reminders_on"] === 1,
    setOn(value, by, at) {
      setOn.run(value ? 1 : 0, by, at);
    },
    sent: (invoiceId) => sent.all(invoiceId).map((row) => ({ kind: row["kind"] as ReminderKind, sentAt: String(row["sent_at"]), sentTo: String(row["sent_to"]) })),
    record(invoiceId, kind, at, to) {
      record.run(invoiceId, kind, at, to);
    },
    isOff: (invoiceId) => isOff.get(invoiceId) !== undefined,
    setOff(invoiceId, off, by, at) {
      if (off) setOff.run(invoiceId, by, at);
      else clearOff.run(invoiceId);
    },
  };
}

export function sqliteChangeRequestStore(db: Database): ChangeRequestStore {
  const columns = "id, project_id, number, title, description, amount_minor, minutes, status, sent_at, decided_at, decided_by_client, decided_by_user, decision_note, invoice_id, created_by";
  const next = db.prepare("select coalesce(max(number), 0) + 1 as n from change_request where project_id = ?");
  const insert = db.prepare(`insert into change_request (${columns}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update change_request set title = ?, description = ?, amount_minor = ?, minutes = ?, status = ?, sent_at = ?, decided_at = ?, decided_by_client = ?, decided_by_user = ?, decision_note = ?, invoice_id = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${columns} from change_request where id = ?`);
  const listFor = db.prepare(`select ${columns} from change_request where project_id = ? order by number desc`);
  const toChange = (row: Record<string, unknown>): ChangeRequest => {
    const client = row["decided_by_client"] as Id | null;
    const user = row["decided_by_user"] as Id | null;
    return {
      id: row["id"] as Id,
      projectId: row["project_id"] as Id,
      number: Number(row["number"]),
      title: String(row["title"]),
      description: String(row["description"]),
      amount: { minor: Number(row["amount_minor"]), currency: "USD" },
      minutes: row["minutes"] === null ? null : Number(row["minutes"]),
      status: row["status"] as ChangeStatus,
      sentAt: (row["sent_at"] as string | null) ?? null,
      decidedAt: (row["decided_at"] as string | null) ?? null,
      decidedBy: client ? { clientUserId: client } : user ? { userId: user } : null,
      decisionNote: String(row["decision_note"]),
      invoiceId: (row["invoice_id"] as Id | null) ?? null,
      createdBy: row["created_by"] as Id,
    };
  };
  const who = (c: ChangeRequest) => [c.decidedBy && "clientUserId" in c.decidedBy ? c.decidedBy.clientUserId : null, c.decidedBy && "userId" in c.decidedBy ? c.decidedBy.userId : null] as const;
  return {
    nextNumber: (projectId) => Number(next.get(projectId)?.["n"] ?? 1),
    insert(c, at) {
      insert.run(c.id, c.projectId, c.number, c.title, c.description, c.amount.minor, c.minutes, c.status, c.sentAt, c.decidedAt, ...who(c), c.decisionNote, c.invoiceId, c.createdBy, at, at);
    },
    update(c, at) {
      update.run(c.title, c.description, c.amount.minor, c.minutes, c.status, c.sentAt, c.decidedAt, ...who(c), c.decisionNote, c.invoiceId, at, c.id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toChange(row) : null;
    },
    listFor: (projectId) => listFor.all(projectId).map(toChange),
  };
}

export function sqliteBillingStore(db: Database): BillingStore {
  const instructions = db.prepare("select pay_instructions from finance_setting where id = 1");
  const setInstructions = db.prepare(
    "insert into finance_setting (id, reminders_on, pay_instructions, updated_by, updated_at) values (1, 0, ?, ?, ?) on conflict (id) do update set pay_instructions = excluded.pay_instructions, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
  );
  const blockCols = "id, organization_id, minutes, bought_on, invoice_id, note, created_by";
  const insertBlock = db.prepare(`insert into prepaid_block (${blockCols}, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`);
  const blocks = db.prepare(`select ${blockCols} from prepaid_block where organization_id = ? order by bought_on, rowid`);
  const withBlocks = db.prepare("select distinct organization_id from prepaid_block");
  const used = db.prepare(
    `select coalesce(sum(t.minutes), 0) as minutes from time_entry t join project p on p.id = t.project_id
      where p.organization_id = ? and t.worked_on >= ? and t.removed_at is null and t.minutes is not null`,
  );
  const pcols = "y.id, y.invoice_id, y.amount_minor, y.currency, y.method, y.received_on, y.reference, y.recorded_by";
  const unreceipted = db.prepare(`select ${pcols} from payment y left join payment_receipt r on r.payment_id = y.id where r.payment_id is null and y.created_at >= ? order by y.rowid`);
  const markReceipt = db.prepare("insert into payment_receipt (payment_id, sent_at, sent_to) values (?, ?, ?) on conflict (payment_id) do nothing");
  const statement = db.prepare("select 1 from client_statement where organization_id = ? and month = ?");
  const markStatement = db.prepare("insert into client_statement (organization_id, month, sent_at, sent_to) values (?, ?, ?, ?) on conflict do nothing");
  const clientPayments = db.prepare(
    `select ${pcols}, i.number as number, coalesce(p.name, '') as project_name, i.lines as lines
       from payment y join invoice i on i.id = y.invoice_id left join project p on p.id = i.project_id
      where i.organization_id = ? and y.received_on >= ? and y.received_on < ? order by y.received_on, y.rowid`,
  );
  const toBlock = (r: Row): PrepaidBlock => ({
    id: text(r, "id") as Id,
    organizationId: text(r, "organization_id") as Id,
    minutes: r["minutes"] as number,
    boughtOn: text(r, "bought_on"),
    invoiceId: maybe(r, "invoice_id") as Id | null,
    note: text(r, "note"),
    createdBy: text(r, "created_by") as Id,
  });
  return {
    payInstructions: () => String((instructions.get() as Row | undefined)?.["pay_instructions"] ?? ""),
    setPayInstructions(text, by, at) {
      setInstructions.run(text, by, at);
    },
    insertBlock(b, at) {
      insertBlock.run(b.id, b.organizationId, b.minutes, b.boughtOn, b.invoiceId, b.note, b.createdBy, at);
    },
    blocksFor: (organizationId) => (blocks.all(organizationId) as Row[]).map(toBlock),
    clientsWithBlocks: () => (withBlocks.all() as Row[]).map((r) => text(r, "organization_id") as Id),
    minutesSince: (organizationId, since) => Number((used.get(organizationId, since) as Row)["minutes"]),
    paymentsWithoutReceipt: (since) => (unreceipted.all(since) as Row[]).map((r) => ({ payment: toPayment(r), invoiceId: text(r, "invoice_id") as Id })),
    markReceipt(paymentId, at, sentTo) {
      markReceipt.run(paymentId, at, sentTo);
    },
    statementSent: (organizationId, month) => statement.get(organizationId, month) !== undefined,
    markStatement(organizationId, month, at, sentTo) {
      markStatement.run(organizationId, month, at, sentTo);
    },
    paymentsForClient: (organizationId, year) =>
      (clientPayments.all(organizationId, `${year}-01-01`, `${year + 1}-01-01`) as Row[]).map((r) => ({
        payment: toPayment(r),
        invoiceNumber: r["number"] as number,
        projectName: text(r, "project_name"),
        forWhat: text(r, "project_name") || ((JSON.parse(text(r, "lines")) as InvoiceLine[])[0]?.description ?? ""),
      })),
  };
}

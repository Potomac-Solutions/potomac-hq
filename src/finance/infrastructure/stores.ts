import type { ExpenseRow, ExpenseStore, FinanceStore, PhaseEstimates, TimeRow, TimeStore } from "../application/ports.ts";
import type { PaymentStatus, ProjectFinance } from "../domain/budget.ts";
import type { Expense, ExpenseCategory } from "../domain/expense.ts";
import type { TimeEntry } from "../domain/time.ts";
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

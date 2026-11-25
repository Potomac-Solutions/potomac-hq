// What Get HQ ready (decision 0015) reads straight from the tables: counts
// and the last backup. Reading changes nothing.
import type { Database } from "../../shared/adapters.ts";

export type SetupCounts = { readonly lastBackupAt: string | null; readonly bookingHours: number; readonly realClients: number; readonly activeUsers: number };

export function sqliteSetupCounts(db: Database): () => SetupCounts {
  const lastBackup = db.prepare("select max(occurred_at) as at from activity_event where action = 'backup.completed'");
  const hours = db.prepare("select count(*) as n from booking_hours");
  const clients = db.prepare("select count(*) as n from client_organization where demo = 0");
  const users = db.prepare("select count(*) as n from user where status = 'active'");
  const count = (statement: typeof hours): number => Number(statement.get()?.["n"] ?? 0);
  return () => ({
    lastBackupAt: (lastBackup.get()?.["at"] as string | null | undefined) ?? null,
    bookingHours: count(hours),
    realClients: count(clients),
    activeUsers: count(users),
  });
}

export type StatusCounts = {
  readonly lastBackupAt: string | null;
  readonly lastBackupFailedAt: string | null;
  readonly database: { readonly bytes: number; readonly migrations: number; readonly lastMigration: string };
};

/** What System status reads straight from the database. */
export function sqliteStatusCounts(db: Database): () => StatusCounts {
  const last = db.prepare("select max(occurred_at) as at from activity_event where action = ?");
  const pages = db.prepare("select page_count * page_size as bytes from pragma_page_count(), pragma_page_size()");
  const migrations = db.prepare("select count(*) as n, max(version) as version, (select name from schema_migration order by version desc limit 1) as name from schema_migration");
  const at = (action: string) => (last.get(action)?.["at"] as string | null | undefined) ?? null;
  return () => {
    const applied = migrations.get();
    return {
      lastBackupAt: at("backup.completed"),
      lastBackupFailedAt: at("backup.failed"),
      database: { bytes: Number(pages.get()?.["bytes"] ?? 0), migrations: Number(applied?.["n"] ?? 0), lastMigration: applied?.["version"] ? `${String(applied["version"]).padStart(4, "0")}-${String(applied["name"] ?? "")}` : "" },
    };
  };
}

/** Each active person's tasks and hours, for Team workload. `today` and `monday` are YYYY-MM-DD. */
export function sqliteWorkload(db: Database): (today: string, monday: string, sunday: string, fourWeeksBefore: string) => import("../domain/workload.ts").WorkloadRow[] {
  const rows = db.prepare(`
    select u.id as userId, u.name as name,
      (select count(*) from task t where t.assignee_id = u.id and t.status <> 'done') as open,
      (select count(*) from task t where t.assignee_id = u.id and t.status <> 'done' and t.due_on between :today and :sunday) as dueThisWeek,
      (select count(*) from task t where t.assignee_id = u.id and t.status <> 'done' and t.due_on < :today) as overdue,
      (select coalesce(sum(minutes), 0) from time_entry e where e.user_id = u.id and e.removed_at is null and e.worked_on >= :monday) as minutesThisWeek,
      (select coalesce(sum(minutes), 0) from time_entry e where e.user_id = u.id and e.removed_at is null and e.worked_on >= :before and e.worked_on < :monday) as minutesLastFourWeeks
    from user u where u.status = 'active' order by u.name`);
  return (today, monday, sunday, before) => rows.all({ today, monday, sunday, before }).map((row) => ({ userId: String(row["userId"]), name: String(row["name"]), open: Number(row["open"]), dueThisWeek: Number(row["dueThisWeek"]), overdue: Number(row["overdue"]), minutesThisWeek: Number(row["minutesThisWeek"]), minutesLastFourWeeks: Number(row["minutesLastFourWeeks"]) }));
}

/** Last week's figures for the weekly owner email, demo clients left out. Dates are YYYY-MM-DD; `to` is included. */
export function sqliteWeekFacts(db: Database): (from: string, to: string, today: string) => Omit<import("../domain/weekly.ts").WeekFacts, "ai"> {
  const real = "p.organization_id in (select id from client_organization where demo = 0)";
  const moneyIn = db.prepare(`select coalesce(sum(pay.amount_minor), 0) as n from payment pay join invoice i on i.id = pay.invoice_id join project p on p.id = i.project_id where ${real} and pay.received_on between ? and ?`);
  const moneyOut = db.prepare(`select coalesce(sum(e.amount_minor), 0) as n from expense e join project p on p.id = e.project_id where ${real} and e.removed_at is null and e.spent_on between ? and ?`);
  const owed = db.prepare(`select coalesce(sum(i.total_minor), 0) - coalesce((select sum(pay.amount_minor) from payment pay join invoice x on x.id = pay.invoice_id join project p on p.id = x.project_id where x.status = 'sent' and ${real}), 0) as n from invoice i join project p on p.id = i.project_id where i.status = 'sent' and ${real}`);
  const overdue = db.prepare(`select count(*) as n from invoice i join project p on p.id = i.project_id where i.status = 'sent' and i.due_on < ? and ${real}`);
  const deals = db.prepare("select count(*) as n from opportunity o join client_organization c on c.id = o.organization_id and c.demo = 0 where substr(o.created_at, 1, 10) between ? and ?");
  const closed = db.prepare("select count(*) as n, coalesce(sum(o.value_minor), 0) as v from opportunity o join client_organization c on c.id = o.organization_id and c.demo = 0 where o.stage = ? and substr(o.closed_at, 1, 10) between ? and ?");
  const atRisk = db.prepare(`select p.name from project p where p.status = 'active' and p.health <> 'on-track' and ${real} order by p.name limit 10`);
  const overdueTasks = db.prepare("select count(*) as n from task where status <> 'done' and due_on < ?");
  const n = (row: Record<string, unknown> | undefined) => Number(row?.["n"] ?? 0);
  return (from, to, today) => {
    const won = closed.get("won", from, to);
    return {
      from,
      to,
      moneyIn: n(moneyIn.get(from, to)),
      moneyOut: n(moneyOut.get(from, to)),
      owed: Math.max(0, n(owed.get())),
      overdueInvoices: n(overdue.get(today)),
      newDeals: n(deals.get(from, to)),
      won: n(won),
      wonValue: Number(won?.["v"] ?? 0),
      lost: n(closed.get("lost", from, to)),
      atRisk: atRisk.all().map((row) => String(row["name"])),
      overdueTasks: n(overdueTasks.get(today)),
    };
  };
}

/** Whether a person was already sent one week's owner email. */
export function sqliteWeeklySent(db: Database): (userId: string, week: string) => boolean {
  const sent = db.prepare("select 1 from activity_event where action = 'weekly-email.sent' and record_id = ? and json_extract(context, '$.week') = ? limit 1");
  return (userId, week) => sent.get(userId, week) !== undefined;
}

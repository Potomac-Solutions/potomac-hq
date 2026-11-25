import type { MonthFacts, MonthlyReport } from "../domain/report.ts";
import type { FactsReader, ReportStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, organization_id, month, status, body, note, sent_to, sent_at";
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

function toReport(row: Record<string, unknown>): MonthlyReport {
  return { id: row["id"] as Id, organizationId: row["organization_id"] as Id, month: String(row["month"]), status: row["status"] as MonthlyReport["status"], body: String(row["body"]), note: String(row["note"]), sentTo: text(row["sent_to"]), sentAt: text(row["sent_at"]) };
}

export function sqliteReportStore(db: Database): ReportStore {
  const get = db.prepare(`select ${COLUMNS} from monthly_report where id = ?`);
  const forMonth = db.prepare(`select ${COLUMNS} from monthly_report where organization_id = ? and month = ?`);
  const listMonth = db.prepare(`select ${COLUMNS} from monthly_report where month = ?`);
  const drafts = db.prepare(`select ${COLUMNS} from monthly_report where status = 'draft' order by month, created_at`);
  const sentFor = db.prepare(`select ${COLUMNS} from monthly_report where organization_id = ? and status = 'sent' order by month desc`);
  const insert = db.prepare(`insert into monthly_report (${COLUMNS}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const save = db.prepare("update monthly_report set status = ?, note = ?, sent_to = ?, sent_at = ?, sent_by = ?, updated_at = ? where id = ?");
  return {
    get(id) {
      const row = get.get(id);
      return row ? toReport(row) : null;
    },
    forMonth(organizationId, month) {
      const row = forMonth.get(organizationId, month);
      return row ? toReport(row) : null;
    },
    listMonth: (month) => listMonth.all(month).map(toReport),
    drafts: () => drafts.all().map(toReport),
    sentFor: (organizationId) => sentFor.all(organizationId).map(toReport),
    insert(report, at) {
      insert.run(report.id, report.organizationId, report.month, report.status, report.body, report.note, report.sentTo, report.sentAt, at, at);
    },
    save(report, sentBy, at) {
      save.run(report.status, report.note, report.sentTo, report.sentAt, report.status === "sent" ? sentBy : null, at, report.id);
    },
  };
}

/** Clients with an active ongoing project: those on a plan. Demo clients are left out. */
export function sqlitePlanClients(db: Database): () => { readonly id: Id; readonly name: string }[] {
  const rows = db.prepare("select distinct c.id, c.name from client_organization c join project p on p.organization_id = c.id where p.kind = 'ongoing' and p.status = 'active' and c.demo = 0 order by c.name");
  return () => rows.all().map((row) => ({ id: row["id"] as Id, name: String(row["name"]) }));
}

export function sqliteFactsReader(db: Database): FactsReader {
  const sites = db.prepare("select id, url from monitored_site where organization_id = ? and active = 1 order by url");
  const outages = db.prepare("select started_at, ended_at from site_outage where site_id = ? and started_at < ? and (ended_at is null or ended_at > ?)");
  const tasksDone = db.prepare("select count(*) as n from task t join project p on p.id = t.project_id where p.organization_id = ? and t.done_at >= ? and t.done_at < ?");
  const milestonesDone = db.prepare("select m.name from milestone m join project p on p.id = m.project_id where p.organization_id = ? and m.done_on >= ? and m.done_on < ? order by m.done_on");
  const publishes = db.prepare("select count(*) as n from activity_event where action = 'site-content.published' and json_extract(context, '$.organizationId') = ? and occurred_at >= ? and occurred_at < ?");
  const changes = db.prepare("select c.title from change_request c join project p on p.id = c.project_id where p.organization_id = ? and c.status = 'approved' and c.decided_at >= ? and c.decided_at < ? order by c.decided_at");
  const milestonesComing = db.prepare("select m.name as what, m.due_on as on_day from milestone m join project p on p.id = m.project_id where p.organization_id = ? and p.status = 'active' and m.done_on is null and m.due_on >= ? and m.due_on <= ?");
  const renewals = db.prepare("select name || ' renews' as what, renews_on as on_day from renewal where organization_id = ? and active = 1 and renews_on >= ? and renews_on <= ?");
  const invoices = db.prepare("select count(*) as n from invoice i join project p on p.id = i.project_id where p.organization_id = ? and i.status = 'sent'");
  const approvals = db.prepare("select count(*) as n from deliverable d join project p on p.id = d.project_id where p.organization_id = ? and d.status = 'shared'");
  const n = (row: Record<string, unknown> | undefined) => Number(row?.["n"] ?? 0);
  return (organizationId, window): MonthFacts => {
    const fromDay = window.from.slice(0, 10);
    const toDay = window.to.slice(0, 10);
    return {
      sites: sites.all(organizationId).map((site) => ({ host: new URL(String(site["url"])).host, outages: outages.all(String(site["id"]), window.to, window.from).map((one) => ({ start: String(one["started_at"]), end: text(one["ended_at"]) })) })),
      tasksDone: n(tasksDone.get(organizationId, window.from, window.to)),
      // Milestones are done on a day; the month's days, in its own dates.
      milestonesDone: milestonesDone.all(organizationId, fromDay, toDay).map((row) => String(row["name"])),
      sitePublishes: n(publishes.get(organizationId, window.from, window.to)),
      changesApproved: changes.all(organizationId, window.from, window.to).map((row) => String(row["title"])),
      comingUp: [...milestonesComing.all(organizationId, window.today, window.horizon), ...renewals.all(organizationId, window.today, window.horizon)].map((row) => ({ what: String(row["what"]), on: String(row["on_day"]) })).sort((a, b) => a.on.localeCompare(b.on)),
      invoicesToPay: n(invoices.get(organizationId)),
      approvalsWaiting: n(approvals.get(organizationId)),
    };
  };
}

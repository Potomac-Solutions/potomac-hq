// What HQ's records say about a client, read for a call's talking points and
// guide (decision 0009, section 2). Reads across modules' tables, and
// changes nothing; the application decides who may see each fact.
import type { ClientFacts, ClientFactsReader } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";

type Row = Record<string, unknown>;
const str = (row: Row, key: string) => String(row[key] ?? "");
const num = (row: Row, key: string) => Number(row[key] ?? 0);

export function sqliteClientFacts(db: Database): ClientFactsReader {
  const projects = db.prepare("select name, status from project where organization_id = ?");
  const proposals = db.prepare(
    `select p.title, p.status, v.sent_at, v.total_minor, v.currency
       from proposal p join opportunity o on o.id = p.opportunity_id
       left join proposal_version v on v.proposal_id = p.id and v.number = p.current_version
      where o.organization_id = ?`,
  );
  const overdue = db.prepare(
    `select i.number, i.due_on, i.total_minor, i.currency from invoice i join project p on p.id = i.project_id
      where p.organization_id = ? and i.status = 'sent' and i.due_on is not null and i.due_on < ? order by i.due_on`,
  );
  // A project's newest message, when it's from the client.
  const unanswered = db.prepare(
    `select p.name, u.created_at, u.client_user_id from project p
       join project_update u on u.project_id = p.id
      where p.organization_id = ? and u.created_at = (select max(created_at) from project_update where project_id = p.id)`,
  );
  const deliverables = db.prepare("select d.title, d.status, p.name from deliverable d join project p on p.id = d.project_id where p.organization_id = ? and d.status in ('shared', 'changes-requested')");
  const callRequests = db.prepare("select wanted, created_at from call_request where organization_id = ? and status = 'requested' order by created_at");
  // Change requests are in dollars (migration 0027 keeps no currency).
  const changes = db.prepare("select c.number, c.title, c.amount_minor, 'USD' as currency from change_request c join project p on p.id = c.project_id where p.organization_id = ? and c.status = 'sent' order by c.number");
  const sites = db.prepare("select url, state, down_since, cert_expires_on from monitored_site where organization_id = ? and active = 1");
  const renewals = db.prepare("select name, renews_on from renewal where organization_id = ? and active = 1 and renews_on between ? and ? order by renews_on");
  const lastCall = db.prepare("select happened_at, note from touch where organization_id = ? and kind = 'call' and note <> '' and (call_id is null or call_id <> ?) order by happened_at desc limit 1");
  const plusDays = (day: string, days: number) => Temporal.PlainDate.from(day).add({ days }).toString();
  return {
    facts(organizationId, today, exceptCallId = null): ClientFacts {
      const projectRows = projects.all(organizationId) as Row[];
      const proposalRows = proposals.all(organizationId) as Row[];
      const soon = plusDays(today, 30);
      const siteRows = sites.all(organizationId) as Row[];
      const deliverableRows = deliverables.all(organizationId) as Row[];
      const last = lastCall.get(organizationId, exceptCallId ?? "") as Row | undefined;
      return {
        activeProjects: projectRows.filter((row) => row["status"] === "active").map((row) => ({ name: str(row, "name") })),
        anyProposalOrProject: projectRows.length > 0 || proposalRows.some((row) => row["status"] !== "draft"),
        proposalsWaiting: proposalRows.filter((row) => row["status"] === "sent" && row["sent_at"]).map((row) => ({ title: str(row, "title"), sentAt: str(row, "sent_at"), totalMinor: num(row, "total_minor"), currency: str(row, "currency") || "USD" })),
        overdueInvoices: (overdue.all(organizationId, today) as Row[]).map((row) => ({ number: num(row, "number"), dueOn: str(row, "due_on"), totalMinor: num(row, "total_minor"), currency: str(row, "currency") || "USD" })),
        messagesUnanswered: (unanswered.all(organizationId) as Row[]).filter((row) => row["client_user_id"] !== null).map((row) => ({ projectName: str(row, "name"), at: str(row, "created_at") })),
        changesAsked: deliverableRows.filter((row) => row["status"] === "changes-requested").map((row) => ({ title: str(row, "title"), projectName: str(row, "name") })),
        callsAsked: (callRequests.all(organizationId) as Row[]).map((row) => ({ wanted: str(row, "wanted"), at: str(row, "created_at") })),
        approvalsWaiting: deliverableRows.filter((row) => row["status"] === "shared").map((row) => ({ title: str(row, "title"), projectName: str(row, "name") })),
        changeRequestsWaiting: (changes.all(organizationId) as Row[]).map((row) => ({ number: num(row, "number"), title: str(row, "title"), amountMinor: num(row, "amount_minor"), currency: str(row, "currency") || "USD" })),
        sitesDown: siteRows.filter((row) => row["state"] === "down").map((row) => ({ url: str(row, "url"), since: str(row, "down_since") })),
        certificatesEnding: siteRows.filter((row) => row["cert_expires_on"] && str(row, "cert_expires_on") <= soon).map((row) => ({ url: str(row, "url"), on: str(row, "cert_expires_on") })),
        renewalsSoon: (renewals.all(organizationId, today, soon) as Row[]).map((row) => ({ name: str(row, "name"), on: str(row, "renews_on") })),
        lastCall: last ? { at: str(last, "happened_at"), note: str(last, "note") } : null,
      };
    },
  };
}

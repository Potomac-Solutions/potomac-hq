// What AI features read from HQ's tables (decision 0012). Read-only, and
// never more than a feature needs: no deal values, no money owed, no
// passwords. Changes AI drafts are made through each module's own services.
import type { AiRecords, DealFacts, ProjectFacts } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const s = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

export function sqliteAiRecords(db: Database): AiRecords {
  const deal = db.prepare(`select o.id, o.organization_id, c.name as client, o.contact_id, coalesce(k.name, '') as contact, coalesce(k.email, '') as email,
      o.owner_id, o.title, o.service, o.summary, o.stage, o.lead_source, o.created_at
    from opportunity o join client_organization c on c.id = o.organization_id left join contact k on k.id = o.contact_id where o.id = ?`);
  const touchesOnDeal = db.prepare("select happened_at, kind, note from touch where opportunity_id = ? order by happened_at desc limit ?");
  const touchesAtClient = db.prepare("select happened_at, kind, note from touch where organization_id = ? order by happened_at desc limit ?");
  const fresh = db.prepare(`select o.id from opportunity o join client_organization c on c.id = o.organization_id
    where o.stage = 'new' and o.created_at >= ? and c.demo = 0 order by o.created_at`);
  const project = db.prepare(`select p.id, p.organization_id, c.name as client, p.name, p.status, p.owner_id, coalesce(o.service, '') as service, coalesce(o.summary, '') as summary,
      p.description, p.created_at, p.updated_at, p.opportunity_id
    from project p join client_organization c on c.id = p.organization_id join opportunity o on o.id = p.opportunity_id where p.id = ?`);
  const agreed = db.prepare(`select v.scope, v.deliverables, v.exclusions, v.lines from proposal pr join proposal_decision d on d.proposal_id = pr.id and d.decision = 'accepted'
    join proposal_version v on v.proposal_id = pr.id and v.number = d.version where pr.opportunity_id = ? order by d.recorded_at desc limit 1`);
  const changes = db.prepare("select title, status from change_request where project_id = ? and status in ('sent', 'approved') order by number");
  const milestones = db.prepare("select name, due_on, done_on from milestone where project_id = ? order by coalesce(due_on, '9999'), created_at");
  const links = db.prepare("select kind, label, url from project_link where project_id = ? and shared = 1 order by created_at");
  const similar = db.prepare(`select p.name, f.budget_minutes,
      (select coalesce(sum(t.minutes), 0) from time_entry t where t.project_id = p.id and t.removed_at is null and t.minutes is not null) as logged
    from project p join opportunity o on o.id = p.opportunity_id join project_finance f on f.project_id = p.id
    where p.status = 'completed' and o.service = ? and f.budget_minutes is not null and f.budget_minutes > 0
    order by p.updated_at desc limit ?`);
  const doneIn = db.prepare("select title from task where project_id = ? and done_at >= ? and done_at < ? order by done_at limit 30");
  const nextUp = db.prepare("select title, due_on from task where project_id = ? and status <> 'done' and (due_on is null or due_on <= ?) order by due_on is null, due_on, created_at limit 15");
  const clientTurn = db.prepare(`select name as title from milestone where project_id = ? and for_client = 1 and done_on is null
    union all select title from deliverable where project_id = ? and status = 'shared'`);
  const active = db.prepare("select p.id from project p join client_organization c on c.id = p.organization_id where p.status = 'active' and c.demo = 0 order by p.created_at");
  const messages = db.prepare(`select u.id, u.project_id, u.body, u.created_at from project_update u join project p on p.id = u.project_id join client_organization c on c.id = p.organization_id
    where u.client_user_id is not null and u.created_at >= ? and c.demo = 0 order by u.created_at`);
  const allArticles = db.prepare("select slug, title, body from article where status = 'current'");
  const site = db.prepare("select id, organization_id, url, last_result, coalesce(cert_expires_on, '') as cert from monitored_site where url = ? and active = 1");
  const outages = db.prepare("select started_at, ended_at, reason from site_outage where site_id = ? order by started_at desc limit 5");
  const user = db.prepare("select name from user where id = ?");

  const toDeal = (row: Record<string, unknown>): DealFacts => ({
    id: row["id"] as Id,
    organizationId: row["organization_id"] as Id,
    client: s(row["client"]),
    contactId: (row["contact_id"] as Id | null) ?? null,
    contact: s(row["contact"]),
    contactEmail: s(row["email"]),
    ownerId: row["owner_id"] as Id,
    title: s(row["title"]),
    service: (row["service"] as string | null) ?? null,
    summary: s(row["summary"]),
    stage: s(row["stage"]),
    leadSource: s(row["lead_source"]),
    createdAt: s(row["created_at"]),
  });

  return {
    deal(id) {
      const row = deal.get(id);
      return row ? toDeal(row) : null;
    },
    touches(where, limit) {
      const rows = "opportunityId" in where ? touchesOnDeal.all(where.opportunityId, limit) : touchesAtClient.all(where.organizationId, limit);
      return rows.map((row) => ({ at: s(row["happened_at"]), kind: s(row["kind"]), note: s(row["note"]) }));
    },
    untriaged(since, triaged) {
      return fresh
        .all(since)
        .map((row) => row["id"] as Id)
        .filter((id) => !triaged(id));
    },
    project(id) {
      const row = project.get(id);
      if (!row) return null;
      const deal = agreed.get(s(row["opportunity_id"]));
      const lines = deal ? (JSON.parse(s(deal["lines"])) as { item?: string }[]).map((one) => s(one.item)).filter(Boolean) : [];
      const facts: ProjectFacts = {
        id: row["id"] as Id,
        organizationId: row["organization_id"] as Id,
        client: s(row["client"]),
        name: s(row["name"]),
        status: s(row["status"]),
        ownerId: row["owner_id"] as Id,
        service: s(row["service"]),
        summary: [s(row["summary"]), s(row["description"])].filter(Boolean).join("\n\n"),
        createdAt: s(row["created_at"]),
        updatedAt: s(row["updated_at"]),
        agreed: deal ? { scope: s(deal["scope"]), deliverables: s(deal["deliverables"]), exclusions: s(deal["exclusions"]), lines } : null,
        changes: changes.all(id).map((one) => `${s(one["title"])} (${s(one["status"]) === "approved" ? "approved" : "waiting on the client"})`),
        milestones: milestones.all(id).map((one) => ({ name: s(one["name"]), dueOn: (one["due_on"] as string | null) ?? null, doneOn: (one["done_on"] as string | null) ?? null })),
        sharedLinks: links.all(id).map((one) => `${s(one["label"]) || s(one["kind"])}: ${s(one["url"])}`),
      };
      return facts;
    },
    similarJobs(service, limit) {
      return similar.all(service, limit).map((row) => ({ project: s(row["name"]), estimatedHours: Math.round(Number(row["budget_minutes"]) / 6) / 10, actualHours: Math.round(Number(row["logged"]) / 6) / 10 }));
    },
    week(projectId, from, to, nextUntil) {
      return {
        done: doneIn.all(projectId, from, to).map((row) => s(row["title"])),
        next: nextUp.all(projectId, nextUntil).map((row) => (row["due_on"] ? `${s(row["title"])} (due ${s(row["due_on"])})` : s(row["title"]))),
        waitingOnClient: clientTurn.all(projectId, projectId).map((row) => s(row["title"])),
      };
    },
    activeProjects: () => active.all().map((row) => row["id"] as Id),
    clientMessages: (since) => messages.all(since).map((row) => ({ id: row["id"] as Id, projectId: row["project_id"] as Id, body: s(row["body"]), at: s(row["created_at"]) })),
    articles(words, limit) {
      // Few enough articles to score in memory: a word in the title counts three times.
      const wanted = words.map((one) => one.toLowerCase()).filter((one) => one.length > 2);
      return allArticles
        .all()
        .map((row) => {
          const title = s(row["title"]).toLowerCase();
          const body = s(row["body"]).toLowerCase();
          const score = wanted.reduce((sum, word) => sum + (title.includes(word) ? 3 : 0) + (body.includes(word) ? 1 : 0), 0);
          return { slug: s(row["slug"]), title: s(row["title"]), body: s(row["body"]), score };
        })
        .filter((one) => one.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ slug, title, body }) => ({ slug, title, body }));
    },
    site(url) {
      const row = site.get(url);
      if (!row) return null;
      return {
        id: row["id"] as Id,
        organizationId: row["organization_id"] as Id,
        url: s(row["url"]),
        lastResult: s(row["last_result"]),
        certExpiresOn: s(row["cert"]),
        outages: outages.all(s(row["id"])).map((one) => `${s(one["started_at"])} to ${s(one["ended_at"]) || "now"}: ${s(one["reason"])}`),
      };
    },
    userName: (id) => s(user.get(id)?.["name"]),
  };
}

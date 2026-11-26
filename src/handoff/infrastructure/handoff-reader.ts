import type { Database } from "../../shared/adapters.ts";
import type { HandoffFacts } from "../application/handoff.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, unknown>;
const STATUS: Readonly<Record<string, string>> = { draft: "Not sent", sent: "Waiting for payment", paid: "Paid", void: "Voided" };

/** What the handoff pack reads about a client, straight from the tables. */
export function sqliteHandoffFacts(db: Database): (organizationId: Id) => HandoffFacts | null {
  const client = db.prepare("select name from client_organization where id = ?");
  const renewals = db.prepare("select kind, name, provider, renews_on, term_months, cost_minor, auto_renews, note from renewal where organization_id = ? and active = 1 order by renews_on");
  const watched = db.prepare("select url from monitored_site where organization_id = ? and active = 1 order by url");
  const content = db.prepare("select name, repo_owner, repo_name, branch from content_site where organization_id = ?");
  const free = db.prepare("select subdomain, repo_owner, repo_name, repo_branch, status from free_page where organization_id = ?");
  const builds = db.prepare("select name from build where organization_id = ? order by updated_at desc");
  const files = db.prepare(
    `select f.id, f.name, coalesce(p.name, '') as project from file f
       left join deliverable d on f.owner_type = 'deliverable' and d.id = f.owner_id
       left join task k on f.owner_type = 'task' and k.id = f.owner_id
       left join project p on p.id = case f.owner_type when 'project' then f.owner_id when 'deliverable' then d.project_id when 'task' then k.project_id end
      where f.organization_id = ? and f.client_visible = 1 and f.id in (select file_id from file_blob) order by f.created_at`,
  );
  const invoices = db.prepare(
    `select i.number, coalesce(i.issued_on, '') as sent_on, i.status, i.total_minor, i.lines,
            (select coalesce(sum(y.amount_minor), 0) from payment y where y.invoice_id = i.id)
            - (select coalesce(sum(r.amount_minor), 0) from payment_refund r join payment y on y.id = r.payment_id where y.invoice_id = i.id) as paid_minor
       from invoice i where i.organization_id = ? and i.status <> 'draft' order by i.number`,
  );
  const intake = db.prepare("select answers from client_intake where organization_id = ?");
  return (organizationId) => {
    const found = client.get(organizationId) as Row | undefined;
    if (!found) return null;
    const sites: { what: string; address: string; code: string }[] = [];
    for (const row of content.all(organizationId) as Row[]) sites.push({ what: `${row["name"]} (you edit it from your portal)`, address: "", code: `github.com/${row["repo_owner"]}/${row["repo_name"]}, branch ${row["branch"]}` });
    for (const row of free.all(organizationId) as Row[]) sites.push({ what: "Your free landing page", address: row["subdomain"] ? `https://${row["subdomain"]}.potomac.solutions` : "", code: row["repo_owner"] ? `github.com/${row["repo_owner"]}/${row["repo_name"]}, branch ${row["repo_branch"]}` : "" });
    for (const row of builds.all(organizationId) as Row[]) sites.push({ what: `${row["name"]} (built in Potomac HQ)`, address: "", code: "In site-code/ in this folder" });
    for (const row of watched.all(organizationId) as Row[]) if (!sites.some((one) => one.address === row["url"])) sites.push({ what: "A site we watch for you", address: row["url"] as string, code: "" });
    const about = (() => {
      const row = intake.get(organizationId) as Row | undefined;
      if (!row) return "";
      const a = JSON.parse(row["answers"] as string) as Record<string, unknown>;
      return Object.entries(a).filter(([key, value]) => key !== "access" && typeof value === "string" && value).map(([key, value]) => `${key}: ${value}`).join("\n");
    })();
    return {
      clientName: found["name"] as string,
      renewals: (renewals.all(organizationId) as Row[]).map((r) => ({ kind: r["kind"] as string, name: r["name"] as string, provider: r["provider"] as string, renewsOn: r["renews_on"] as string, termMonths: r["term_months"] as number, costMinor: (r["cost_minor"] as number | null) ?? null, autoRenews: r["auto_renews"] === 1, note: r["note"] as string })),
      sites,
      files: (files.all(organizationId) as Row[]).map((r) => ({ id: r["id"] as Id, name: r["name"] as string, project: r["project"] as string })),
      invoices: (invoices.all(organizationId) as Row[]).map((r) => ({ number: r["number"] as number, sentOn: r["sent_on"] as string, status: STATUS[r["status"] as string] ?? (r["status"] as string), totalMinor: r["total_minor"] as number, paidMinor: r["paid_minor"] as number, what: (JSON.parse(r["lines"] as string) as { description?: string }[])[0]?.description ?? "" })),
      about,
    };
  };
}

/** The client's newest built site and its latest version number, or null. */
export function sqliteLatestBuild(db: Database): (organizationId: Id) => { readonly buildId: Id; readonly number: number } | null {
  const latest = db.prepare(
    `select b.id, (select max(v.number) from build_version v where v.build_id = b.id) as number
       from build b where b.organization_id = ? order by b.updated_at desc limit 1`,
  );
  return (organizationId) => {
    const row = latest.get(organizationId) as Row | undefined;
    return row && row["number"] ? { buildId: row["id"] as Id, number: row["number"] as number } : null;
  };
}

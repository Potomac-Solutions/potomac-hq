import type { LeadRow } from "../domain/source.ts";
import type { LeadStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

export function sqliteLeadStore(db: Database): LeadStore {
  const keep = db.prepare("insert into lead_touch (opportunity_id, src, path, utm_source, utm_medium, utm_campaign, received_at) values (?, ?, ?, ?, ?, ?, ?) on conflict do nothing");
  const get = db.prepare("select src, path, utm_source, utm_medium, utm_campaign, received_at from lead_touch where opportunity_id = ?");
  const newest = db.prepare("select id from opportunity where organization_id = ? and stage not in ('won', 'lost') order by created_at desc, id desc limit 1");
  // Had a call: a stage past the call, a call that reached them or a meeting
  // since the lead came in, or a booked call (not cancelled) that has started.
  const rows = db.prepare(`
    select o.lead_source, o.stage, coalesce(o.value_minor, 0) as value_minor,
      coalesce(t.src, '') as src, coalesce(t.utm_source, '') as utm_source,
      (select l.code from referral_inquiry ri join referral_link l on l.id = ri.link_id where ri.opportunity_id = o.id) as referral_code,
      (o.stage in ('consulted', 'quoted', 'won')
        or exists (select 1 from touch x where (x.opportunity_id = o.id or (x.opportunity_id is null and x.organization_id = o.organization_id)) and x.happened_at >= o.created_at and (x.kind = 'meeting' or (x.kind = 'call' and x.outcome = 'reached')))
        or exists (select 1 from booking b where b.status = 'booked' and b.starts_at <= $now and b.starts_at >= o.created_at and (b.crm_opportunity_id = o.id or b.organization_id = o.organization_id or b.crm_client_id = o.organization_id))) as had_call,
      (o.stage in ('quoted', 'won') or exists (select 1 from proposal p where p.opportunity_id = o.id and p.status <> 'draft')) as proposal_sent
    from opportunity o
    join client_organization c on c.id = o.organization_id
    left join lead_touch t on t.opportunity_id = o.id
    where o.created_at >= $since and c.demo = 0
    order by o.created_at`);
  return {
    keepFirst(opportunityId, touch, at) {
      keep.run(opportunityId, touch.src, touch.path, touch.utmSource, touch.utmMedium, touch.utmCampaign, at);
    },
    get(opportunityId) {
      const row = get.get(opportunityId);
      return row ? { src: String(row["src"]), path: String(row["path"]), utmSource: String(row["utm_source"]), utmMedium: String(row["utm_medium"]), utmCampaign: String(row["utm_campaign"]), receivedAt: String(row["received_at"]) } : null;
    },
    newestOpenAt(organizationId) {
      const row = newest.get(organizationId);
      return row ? (row["id"] as Id) : null;
    },
    rows(since, now): LeadRow[] {
      return rows.all({ since, now }).map((row) => ({
        leadSource: String(row["lead_source"]),
        src: String(row["src"]),
        utmSource: String(row["utm_source"]),
        referralCode: row["referral_code"] === null || row["referral_code"] === undefined ? null : String(row["referral_code"]),
        hadCall: Number(row["had_call"]) === 1,
        proposalSent: Number(row["proposal_sent"]) === 1,
        won: row["stage"] === "won",
        wonMinor: row["stage"] === "won" ? Number(row["value_minor"]) : 0,
      }));
    },
  };
}

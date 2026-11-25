import type { ReferralCreditStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

export function sqliteReferralCreditStore(db: Database): ReferralCreditStore {
  const referredBy = db.prepare("select referred_by_org, referred_by_name, organization_id from opportunity where id = ?");
  const setReferredBy = db.prepare("update opportunity set referred_by_org = ?, referred_by_name = ?, updated_at = ? where id = ?");
  const linkOwner = db.prepare("select l.organization_id from referral_inquiry ri join referral_link l on l.id = ri.link_id where ri.opportunity_id = ? and l.organization_id is not null");
  const linkFor = db.prepare("select id, code from referral_link where organization_id = ?");
  const setLinkOwner = db.prepare("update referral_link set organization_id = ? where id = ?");
  const referredByClient = db.prepare("select id, title, organization_id, created_at from opportunity where referred_by_org = ? order by created_at desc");
  // A referred client counts once, at the first client who referred them.
  const due = db.prepare(`
    select o.referred_by_org as referrer_id, o.organization_id as referred_id
    from opportunity o
    where o.referred_by_org is not null and o.referred_by_org <> o.organization_id
      and not exists (select 1 from referral_credit c where c.referred_id = o.organization_id)
      and exists (select 1 from invoice i where i.organization_id = o.organization_id and i.status = 'paid')
      and o.created_at = (select min(o2.created_at) from opportunity o2 where o2.organization_id = o.organization_id and o2.referred_by_org is not null)
    group by o.organization_id`);
  const addCredit = db.prepare("insert into referral_credit (id, referrer_id, referred_id, amount_minor, earned_at) values (?, ?, ?, ?, ?) on conflict do nothing");
  const credits = db.prepare("select referred_id, amount_minor, earned_at from referral_credit where referrer_id = ? order by earned_at");
  const earned = db.prepare("select coalesce(sum(amount_minor), 0) as n from referral_credit where referrer_id = ?");
  const used = db.prepare("select coalesce(sum(amount_minor), 0) as n from referral_credit_use where referrer_id = ?");
  const addUse = db.prepare("insert into referral_credit_use (id, referrer_id, invoice_id, amount_minor, used_by, used_at) values (?, ?, ?, ?, ?, ?)");
  const removeUse = db.prepare("delete from referral_credit_use where id = ?");
  const setting = db.prepare("select credit_minor from referral_setting where id = 1");
  const setSetting = db.prepare("insert into referral_setting (id, credit_minor, updated_by, updated_at) values (1, ?, ?, ?) on conflict (id) do update set credit_minor = excluded.credit_minor, updated_by = excluded.updated_by, updated_at = excluded.updated_at");
  const invoice = db.prepare("select i.organization_id, i.total_minor, i.status from invoice i where i.id = ?");
  const n = (row: Record<string, unknown> | undefined) => Number(row?.["n"] ?? 0);
  return {
    referredBy(opportunityId) {
      const row = referredBy.get(opportunityId);
      return row ? { organizationId: (row["referred_by_org"] as Id | null) ?? null, name: (row["referred_by_name"] as string | null) ?? null, clientId: row["organization_id"] as Id } : null;
    },
    setReferredBy(opportunityId, who, at) {
      setReferredBy.run(who.organizationId, who.name, at, opportunityId);
    },
    linkOwnerFor: (opportunityId) => (linkOwner.get(opportunityId)?.["organization_id"] as Id | undefined) ?? null,
    linkFor(organizationId) {
      const row = linkFor.get(organizationId);
      return row ? { id: row["id"] as Id, code: String(row["code"]) } : null;
    },
    setLinkOwner(linkId, organizationId) {
      setLinkOwner.run(organizationId, linkId);
    },
    referredByClient: (organizationId) => referredByClient.all(organizationId).map((row) => ({ opportunityId: row["id"] as Id, title: String(row["title"]), clientId: row["organization_id"] as Id, createdAt: String(row["created_at"]) })),
    creditsDue: () => due.all().map((row) => ({ referrerId: row["referrer_id"] as Id, referredId: row["referred_id"] as Id })),
    addCredit(c) {
      addCredit.run(c.id, c.referrerId, c.referredId, c.minor, c.at);
    },
    credits: (referrerId) => credits.all(referrerId).map((row) => ({ referredId: row["referred_id"] as Id, minor: Number(row["amount_minor"]), at: String(row["earned_at"]) })),
    earnedMinor: (referrerId) => n(earned.get(referrerId)),
    usedMinor: (referrerId) => n(used.get(referrerId)),
    addUse(u) {
      addUse.run(u.id, u.referrerId, u.invoiceId, u.minor, u.userId, u.at);
    },
    removeUse(id) {
      removeUse.run(id);
    },
    creditMinor() {
      const row = setting.get();
      return row ? Number(row["credit_minor"]) : null;
    },
    setCreditMinor(minor, userId, at) {
      setSetting.run(minor, userId, at);
    },
    invoice(invoiceId) {
      const row = invoice.get(invoiceId);
      return row ? { organizationId: row["organization_id"] as Id, totalMinor: Number(row["total_minor"]), status: String(row["status"]) } : null;
    },
  };
}

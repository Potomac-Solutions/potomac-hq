import type { ClientStore, ContactStore, OpportunityStore } from "../application/ports.ts";
import type { Client, ClientStatus, SizeTier } from "../domain/client.ts";
import type { Contact } from "../domain/contact.ts";
import type { LeadSource, Opportunity, Pricing, Service, Stage } from "../domain/opportunity.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Currency, Id } from "../../shared/index.ts";

type ClientRow = { id: string; name: string; status: string; size_tier: string | null; website: string | null; phone: string | null; address: string | null };
const toClient = (r: ClientRow): Client => ({
  id: r.id as Id,
  name: r.name,
  status: r.status as ClientStatus,
  sizeTier: r.size_tier as SizeTier | null,
  website: r.website,
  phone: r.phone,
  address: r.address,
});

export function sqliteClientStore(db: Database): ClientStore {
  const cols = "id, name, status, size_tier, website, phone, address";
  const insert = db.prepare(`insert into client_organization (${cols}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update client_organization set name = ?, status = ?, size_tier = ?, website = ?, phone = ?, address = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${cols} from client_organization where id = ?`);
  const list = db.prepare(
    `select c.id, c.name, c.status, c.size_tier, c.website, c.phone, c.address,
            (select count(*) from opportunity o where o.organization_id = c.id and o.stage not in ('won', 'lost')) as open
       from client_organization c
      order by c.created_at desc, c.rowid desc`,
  );
  return {
    insert(c, at) {
      insert.run(c.id, c.name, c.status, c.sizeTier, c.website, c.phone, c.address, at, at);
    },
    update(c, at) {
      update.run(c.name, c.status, c.sizeTier, c.website, c.phone, c.address, at, c.id);
    },
    get(id) {
      const r = get.get(id) as ClientRow | undefined;
      return r ? toClient(r) : null;
    },
    list() {
      return (list.all() as (ClientRow & { open: number })[]).map((r) => ({ ...toClient(r), openOpportunities: r.open }));
    },
  };
}

type ContactRow = { id: string; organization_id: string; name: string; email: string | null; phone: string | null; title: string | null; is_primary: number };
const toContact = (r: ContactRow): Contact => ({
  id: r.id as Id,
  organizationId: r.organization_id as Id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  title: r.title,
  isPrimary: r.is_primary === 1,
});

export function sqliteContactStore(db: Database): ContactStore {
  const cols = "id, organization_id, name, email, phone, title, is_primary";
  const insert = db.prepare(`insert into contact (${cols}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const clear = db.prepare("update contact set is_primary = 0, updated_at = ? where organization_id = ? and is_primary = 1");
  const get = db.prepare(`select ${cols} from contact where id = ?`);
  const listFor = db.prepare(`select ${cols} from contact where organization_id = ? order by is_primary desc, name collate nocase`);
  return {
    insert(c, at) {
      insert.run(c.id, c.organizationId, c.name, c.email, c.phone, c.title, c.isPrimary ? 1 : 0, at, at);
    },
    clearPrimary(organizationId, at) {
      clear.run(at, organizationId);
    },
    get(id) {
      const r = get.get(id) as ContactRow | undefined;
      return r ? toContact(r) : null;
    },
    listFor(organizationId) {
      return (listFor.all(organizationId) as ContactRow[]).map(toContact);
    },
  };
}

type OpportunityRow = {
  id: string;
  organization_id: string;
  contact_id: string | null;
  owner_id: string;
  title: string;
  service: string | null;
  stage: string;
  pricing: string | null;
  value_minor: number | null;
  currency: string;
  lead_source: string;
  follow_up_on: string | null;
  summary: string;
  lost_reason: string | null;
  closed_at: string | null;
};
const toOpportunity = (r: OpportunityRow): Opportunity => ({
  id: r.id as Id,
  organizationId: r.organization_id as Id,
  contactId: r.contact_id as Id | null,
  ownerId: r.owner_id as Id,
  title: r.title,
  service: r.service as Service | null,
  stage: r.stage as Stage,
  pricing: r.pricing as Pricing | null,
  value: r.value_minor === null ? null : { minor: r.value_minor, currency: r.currency as Currency },
  leadSource: r.lead_source as LeadSource,
  followUpOn: r.follow_up_on,
  summary: r.summary,
  lostReason: r.lost_reason,
  closedAt: r.closed_at,
});

export function sqliteOpportunityStore(db: Database): OpportunityStore {
  const cols =
    "id, organization_id, contact_id, owner_id, title, service, stage, pricing, value_minor, currency, lead_source, follow_up_on, summary, lost_reason, closed_at";
  const insert = db.prepare(`insert into opportunity (${cols}, created_at, updated_at) values (${Array(17).fill("?").join(", ")})`);
  const update = db.prepare(
    `update opportunity set contact_id = ?, owner_id = ?, title = ?, service = ?, stage = ?, pricing = ?, value_minor = ?, currency = ?,
            lead_source = ?, follow_up_on = ?, summary = ?, lost_reason = ?, closed_at = ?, updated_at = ?
      where id = ?`,
  );
  const get = db.prepare(`select ${cols} from opportunity where id = ?`);
  const listFor = db.prepare(`select ${cols} from opportunity where organization_id = ? order by created_at desc, rowid desc`);
  const dueBy = db.prepare(
    `select ${cols.split(", ").map((c) => `o.${c}`).join(", ")}, c.name as client_name
       from opportunity o join client_organization c on c.id = o.organization_id
      where o.follow_up_on is not null and o.follow_up_on <= ? and o.stage not in ('won', 'lost')
      order by o.follow_up_on, o.rowid`,
  );
  const listOpen = db.prepare(
    `select ${cols.split(", ").map((c) => `o.${c}`).join(", ")}, c.name as client_name
       from opportunity o join client_organization c on c.id = o.organization_id
      where o.stage not in ('won', 'lost')
      order by o.created_at, o.rowid`,
  );
  const listAll = db.prepare(`select ${cols} from opportunity order by created_at, rowid`);
  const values = (o: Opportunity) => [o.service, o.stage, o.pricing, o.value?.minor ?? null, o.value?.currency ?? "USD", o.leadSource, o.followUpOn, o.summary, o.lostReason, o.closedAt] as const;
  return {
    insert(o, at) {
      insert.run(o.id, o.organizationId, o.contactId, o.ownerId, o.title, ...values(o), at, at);
    },
    update(o, at) {
      update.run(o.contactId, o.ownerId, o.title, ...values(o), at, o.id);
    },
    get(id) {
      const r = get.get(id) as OpportunityRow | undefined;
      return r ? toOpportunity(r) : null;
    },
    listFor(organizationId) {
      return (listFor.all(organizationId) as OpportunityRow[]).map(toOpportunity);
    },
    listAll() {
      return (listAll.all() as OpportunityRow[]).map(toOpportunity);
    },
    listOpen() {
      return (listOpen.all() as (OpportunityRow & { client_name: string })[]).map((r) => ({ ...toOpportunity(r), clientName: r.client_name }));
    },
    dueBy(date) {
      return (dueBy.all(date) as (OpportunityRow & { client_name: string })[]).map((r) => ({ ...toOpportunity(r), clientName: r.client_name }));
    },
  };
}

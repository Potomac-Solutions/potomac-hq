import type { Renewal, RenewalChoice, RenewalKind } from "../domain/renewal.ts";
import type { RenewalStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, organization_id, kind, name, provider, renews_on, term_months, cost_minor, price_minor, auto_renews, note, active, invoice_id, billed_for";
const READ = `${COLUMNS}, client_answer, answered_for, answered_at, answered_by, price_was_minor, price_changed_on`;
const money = (minor: unknown) => (minor === null || minor === undefined ? null : { minor: Number(minor), currency: "USD" as const });

function toRenewal(row: Record<string, unknown>): Renewal {
  return {
    id: row["id"] as Id,
    organizationId: row["organization_id"] as Id,
    kind: row["kind"] as RenewalKind,
    name: String(row["name"]),
    provider: String(row["provider"]),
    renewsOn: String(row["renews_on"]),
    termMonths: Number(row["term_months"]),
    cost: money(row["cost_minor"]),
    price: money(row["price_minor"]),
    autoRenews: row["auto_renews"] === 1,
    note: String(row["note"]),
    active: row["active"] === 1,
    invoiceId: row["invoice_id"] === null || row["invoice_id"] === undefined ? null : (row["invoice_id"] as Id),
    billedFor: row["billed_for"] === null || row["billed_for"] === undefined ? null : String(row["billed_for"]),
    priceChange: row["price_changed_on"] ? { was: row["price_was_minor"] === null || row["price_was_minor"] === undefined ? null : { minor: Number(row["price_was_minor"]), currency: "USD" }, on: String(row["price_changed_on"]) } : null,
    answer: row["client_answer"] ? { choice: row["client_answer"] as RenewalChoice, forTerm: String(row["answered_for"]), at: String(row["answered_at"]), by: row["answered_by"] as Id } : null,
  };
}

export function sqliteRenewalStore(db: Database): RenewalStore {
  const insert = db.prepare(`insert into renewal (${COLUMNS}, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update renewal set kind = ?, name = ?, provider = ?, renews_on = ?, term_months = ?, cost_minor = ?, price_minor = ?, auto_renews = ?, note = ?, active = ?, invoice_id = ?, billed_for = ?, price_was_minor = ?, price_changed_on = ?, updated_at = ? where id = ?");
  const get = db.prepare(`select ${READ} from renewal where id = ?`);
  const active = db.prepare(`select ${READ} from renewal where active = 1 order by renews_on, name`);
  const answer = db.prepare("update renewal set client_answer = ?, answered_for = ?, answered_at = ?, answered_by = ?, updated_at = ? where id = ?");
  const forClient = db.prepare(`select ${READ} from renewal where active = 1 and organization_id = ? order by renews_on, name`);
  return {
    insert(r, at) {
      insert.run(r.id, r.organizationId, r.kind, r.name, r.provider, r.renewsOn, r.termMonths, r.cost?.minor ?? null, r.price?.minor ?? null, r.autoRenews ? 1 : 0, r.note, r.active ? 1 : 0, r.invoiceId, r.billedFor, at, at);
    },
    update(r, at) {
      update.run(r.kind, r.name, r.provider, r.renewsOn, r.termMonths, r.cost?.minor ?? null, r.price?.minor ?? null, r.autoRenews ? 1 : 0, r.note, r.active ? 1 : 0, r.invoiceId, r.billedFor, r.priceChange ? (r.priceChange.was?.minor ?? null) : null, r.priceChange?.on ?? null, at, r.id);
    },
    get(id) {
      const row = get.get(id);
      return row ? toRenewal(row) : null;
    },
    answer(id, given, at) {
      answer.run(given.choice, given.forTerm, given.at, given.by, at, id);
    },
    listActive: () => active.all().map(toRenewal),
    listFor: (organizationId) => forClient.all(organizationId).map(toRenewal),
  };
}

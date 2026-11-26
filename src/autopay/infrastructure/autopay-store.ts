import type { Database } from "../../shared/adapters.ts";
import type { Autopay, AutopayStore, PlanInvoice } from "../application/autopay.ts";
import type { Id } from "../../shared/index.ts";
import type { Try } from "../domain/autopay.ts";

type Row = Record<string, unknown>;
const toAutopay = (r: Row): Autopay => ({
  organizationId: r["organization_id"] as Id,
  platform: r["platform"] as string,
  token: (r["token"] as string | null) ?? null,
  label: r["label"] as string,
  setupRef: (r["setup_ref"] as string | null) ?? null,
  setupUrl: (r["setup_url"] as string | null) ?? null,
  setUpBy: (r["set_up_by"] as Id | null) ?? null,
  setUpAt: (r["set_up_at"] as string | null) ?? null,
  stoppedAt: (r["stopped_at"] as string | null) ?? null,
});

export function sqliteAutopayStore(db: Database): AutopayStore {
  const get = db.prepare("select * from autopay where organization_id = ?");
  const save = db.prepare(
    `insert into autopay (organization_id, platform, token, label, setup_ref, setup_url, set_up_by, set_up_at, stopped_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (organization_id) do update set platform = excluded.platform, token = excluded.token, label = excluded.label, setup_ref = excluded.setup_ref, setup_url = excluded.setup_url,
         set_up_by = excluded.set_up_by, set_up_at = excluded.set_up_at, stopped_at = excluded.stopped_at, updated_at = excluded.updated_at`,
  );
  const plan = db.prepare("select 1 from recurring_invoice where organization_id = ? and active = 1 limit 1");
  const due = db.prepare(
    `select i.id, i.number, i.organization_id, c.name as client_name, i.currency, i.created_by,
            i.total_minor - (select coalesce(sum(y.amount_minor), 0) from payment y where y.invoice_id = i.id)
              + (select coalesce(sum(r.amount_minor), 0) from payment_refund r join payment y on y.id = r.payment_id where y.invoice_id = i.id) as owed_minor
       from invoice i join autopay a on a.organization_id = i.organization_id and a.token is not null and a.stopped_at is null
       join client_organization c on c.id = i.organization_id
      where i.status = 'sent' and i.recurring_id is not null
      order by i.number`,
  );
  const tries = db.prepare("select tried_on, outcome from autopay_charge where invoice_id = ? order by tried_on");
  const start = db.prepare("insert into autopay_charge (id, invoice_id, owed_minor, tried_on, outcome, created_at) values (?, ?, ?, ?, 'trying', ?) on conflict (invoice_id, tried_on) do nothing");
  const end = db.prepare("update autopay_charge set outcome = ?, reference = ?, reason = ? where id = ?");
  const recent = db.prepare(
    `select i.number, t.tried_on, t.outcome, t.reason from autopay_charge t join invoice i on i.id = t.invoice_id
      where i.organization_id = ? order by t.tried_on desc, t.created_at desc limit 6`,
  );
  return {
    get: (id) => {
      const r = get.get(id) as Row | undefined;
      return r ? toAutopay(r) : null;
    },
    save: (a, at) => void save.run(a.organizationId, a.platform, a.token, a.label, a.setupRef, a.setupUrl, a.setUpBy, a.setUpAt, a.stoppedAt, at),
    hasPlan: (id) => plan.get(id) !== undefined,
    due: () =>
      (due.all() as Row[])
        .filter((r) => (r["owed_minor"] as number) > 0)
        .map((r): PlanInvoice => ({ id: r["id"] as Id, number: r["number"] as number, organizationId: r["organization_id"] as Id, clientName: r["client_name"] as string, owedMinor: r["owed_minor"] as number, currency: "USD", createdBy: r["created_by"] as Id })),
    tries: (id) => (tries.all(id) as Row[]).map((r): Try => ({ triedOn: r["tried_on"] as string, outcome: r["outcome"] as Try["outcome"] })),
    startTry: (e) => Number(start.run(e.id, e.invoiceId, e.owedMinor, e.triedOn, e.createdAt).changes) === 1,
    endTry: (id, outcome, reference, reason) => void end.run(outcome, reference, reason, id),
    recent: (id) => (recent.all(id) as Row[]).map((r) => ({ number: r["number"] as number, triedOn: r["tried_on"] as string, outcome: r["outcome"] as string, reason: r["reason"] as string })),
  };
}

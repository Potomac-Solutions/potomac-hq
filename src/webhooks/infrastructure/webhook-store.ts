import type { Delivery, DeliveryState, DeliveryStore, WebhookStore } from "../application/webhooks.ts";
import type { HookEvent, Webhook } from "../domain/webhook.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, unknown>;
const text = (r: Row, key: string) => String(r[key] ?? "");
const maybe = (r: Row, key: string) => (r[key] === null || r[key] === undefined ? null : String(r[key]));

const toWebhook = (r: Row): Webhook => ({ id: text(r, "id") as Id, url: text(r, "url"), events: JSON.parse(text(r, "events")) as HookEvent[], paused: r["paused"] === 1, salt: text(r, "salt"), createdBy: text(r, "created_by") as Id, createdAt: text(r, "created_at") });

export function sqliteWebhookStore(db: Database): WebhookStore {
  const cols = "id, url, events, paused, salt, created_by, created_at";
  const insert = db.prepare(`insert into webhook (${cols}) values (?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update webhook set url = ?, events = ?, paused = ?, salt = ? where id = ?");
  const remove = db.prepare("delete from webhook where id = ?");
  const get = db.prepare(`select ${cols} from webhook where id = ?`);
  const list = db.prepare(`select ${cols} from webhook order by created_at, rowid`);
  const forEvent = db.prepare(`select ${cols} from webhook where paused = 0 and exists (select 1 from json_each(events) where value = ?) order by created_at, rowid`);
  return {
    insert: (w) => void insert.run(w.id, w.url, JSON.stringify(w.events), w.paused ? 1 : 0, w.salt, w.createdBy, w.createdAt),
    update: (w) => void update.run(w.url, JSON.stringify(w.events), w.paused ? 1 : 0, w.salt, w.id),
    remove: (id) => void remove.run(id),
    get(id) {
      const found = get.get(id) as Row | undefined;
      return found ? toWebhook(found) : null;
    },
    list: () => (list.all() as Row[]).map(toWebhook),
    forEvent: (event) => (forEvent.all(event) as Row[]).map(toWebhook),
  };
}

const toDelivery = (r: Row): Delivery => ({
  id: text(r, "id") as Id,
  webhookId: text(r, "webhook_id") as Id,
  event: text(r, "event"),
  payload: text(r, "payload"),
  createdAt: text(r, "created_at"),
  state: text(r, "state") as DeliveryState,
  attempts: Number(r["attempts"]),
  nextAt: maybe(r, "next_at"),
  lastTriedAt: maybe(r, "last_tried_at"),
  lastStatus: r["last_status"] === null || r["last_status"] === undefined ? null : Number(r["last_status"]),
  lastAnswer: text(r, "last_answer"),
});

export function sqliteDeliveryStore(db: Database): DeliveryStore {
  const cols = "id, webhook_id, event, payload, created_at, state, attempts, next_at, last_tried_at, last_status, last_answer";
  const insert = db.prepare(`insert into webhook_delivery (${cols}) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare("update webhook_delivery set state = ?, attempts = ?, next_at = ?, last_tried_at = ?, last_status = ?, last_answer = ? where id = ?");
  const due = db.prepare(`select ${cols.split(", ").map((c) => `d.${c}`).join(", ")} from webhook_delivery d join webhook w on w.id = d.webhook_id where d.state = 'pending' and w.paused = 0 and d.next_at <= ? order by d.next_at, d.rowid limit ?`);
  const forWebhook = db.prepare(`select ${cols} from webhook_delivery where webhook_id = ? order by created_at desc, rowid desc limit ?`);
  const prune = db.prepare("delete from webhook_delivery where webhook_id = ? and id not in (select id from webhook_delivery where webhook_id = ? order by created_at desc, rowid desc limit ?)");
  return {
    insert: (d) => void insert.run(d.id, d.webhookId, d.event, d.payload, d.createdAt, d.state, d.attempts, d.nextAt, d.lastTriedAt, d.lastStatus, d.lastAnswer),
    update: (d) => void update.run(d.state, d.attempts, d.nextAt, d.lastTriedAt, d.lastStatus, d.lastAnswer, d.id),
    due: (now, limit) => (due.all(now, limit) as Row[]).map(toDelivery),
    forWebhook: (webhookId, limit) => (forWebhook.all(webhookId, limit) as Row[]).map(toDelivery),
    prune: (webhookId, keep) => void prune.run(webhookId, webhookId, keep),
  };
}

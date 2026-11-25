// Phone alerts' devices, queue and sources (migration 0076).
import type { AlertQueue, AlertSources, DeviceStore, QueuedAlert, StoredDevice } from "../application/push.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, unknown>;

export function sqliteDeviceStore(db: Database): DeviceStore {
  const forUser = db.prepare("select * from push_subscription where user_id = ? order by created_at");
  const save = db.prepare("insert into push_subscription (id, user_id, endpoint, p256dh, auth, label, created_at) values (?, ?, ?, ?, ?, ?, ?) on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, failures = 0");
  const remove = db.prepare("delete from push_subscription where user_id = ? and id = ?");
  const removeEndpoint = db.prepare("delete from push_subscription where endpoint = ?");
  const sent = db.prepare("update push_subscription set last_ok_at = ?, failures = 0 where id = ?");
  // A device that keeps failing is let go after 20 tries.
  const failed = db.prepare("update push_subscription set failures = failures + 1 where id = ?");
  const tooMany = db.prepare("delete from push_subscription where id = ? and failures >= 20");
  const toDevice = (row: Row): StoredDevice => ({ id: row["id"] as Id, userId: row["user_id"] as Id, endpoint: String(row["endpoint"]), p256dh: String(row["p256dh"]), auth: String(row["auth"]), label: String(row["label"] ?? ""), createdAt: String(row["created_at"]) });
  return {
    forUser: (userId) => forUser.all(userId).map(toDevice),
    save: (d) => void save.run(d.id, d.userId, d.endpoint, d.p256dh, d.auth, d.label, d.createdAt),
    remove: (userId, id) => Number(remove.run(userId, id).changes) > 0,
    removeEndpoint: (endpoint) => void removeEndpoint.run(endpoint),
    sent: (id, at) => void sent.run(at, id),
    failed(id) {
      failed.run(id);
      tooMany.run(id);
    },
  };
}

export function sqliteAlertQueue(db: Database): AlertQueue {
  const add = db.prepare("insert into push_queue (id, user_id, key, title, body, url, created_at) values (?, ?, ?, ?, ?, ?, ?) on conflict (user_id, key) do nothing");
  const waiting = db.prepare("select * from push_queue where sent_at is null and dropped_at is null order by created_at limit ?");
  const sent = db.prepare("update push_queue set sent_at = ? where id = ?");
  const dropped = db.prepare("update push_queue set dropped_at = ? where id = ?");
  return {
    add: (a) => void add.run(a.id, a.userId, a.key, a.title.slice(0, 120), a.body.slice(0, 300), a.url, a.createdAt),
    waiting: (limit) => waiting.all(limit).map((row): QueuedAlert => ({ id: row["id"] as Id, userId: row["user_id"] as Id, key: String(row["key"]), title: String(row["title"]), body: String(row["body"]), url: String(row["url"]), createdAt: String(row["created_at"]) })),
    sent: (id, at) => void sent.run(at, id),
    dropped: (id, at) => void dropped.run(at, id),
  };
}

export function sqliteAlertSources(db: Database): AlertSources {
  const notices = db.prepare("select n.id, n.user_id, n.kind, n.detail, t.title as task_title, coalesce(u.name, '') as actor_name from notice n join task t on t.id = n.task_id left join user u on u.id = n.actor_id where n.created_at >= ? and n.read_at is null order by n.created_at");
  const events = db.prepare(`
    select e.id, e.action, e.record_id,
      case e.action
        when 'site.down' then coalesce(json_extract(e.context, '$.url'), 'a site')
        when 'project.message-received' then coalesce((select name from project where id = e.record_id), 'a project')
        when 'call.requested' then coalesce((select c.name from client_organization c where c.id = json_extract(e.context, '$.organizationId')), 'A client')
      end as name,
      case e.action when 'project.message-received' then (select owner_id from project where id = e.record_id) end as owner_id
    from activity_event e
    where e.occurred_at >= ? and e.action in ('site.down', 'project.message-received', 'call.requested')
    order by e.rowid`);
  const calls = db.prepare("select id, host_id, name, starts_at from booking where status = 'booked' and starts_at > ? and starts_at <= ? order by starts_at");
  return {
    notices: (since) => notices.all(since).map((row) => ({ id: String(row["id"]), userId: row["user_id"] as Id, kind: String(row["kind"]), actorName: String(row["actor_name"]), taskTitle: String(row["task_title"]), detail: String(row["detail"] ?? "") })),
    events: (since) => events.all(since).map((row) => ({ id: String(row["id"]), action: String(row["action"]), recordId: String(row["record_id"]), name: String(row["name"] ?? ""), ownerId: (row["owner_id"] as Id | null) ?? null })),
    calls: (from, to) => calls.all(from, to).map((row) => ({ id: String(row["id"]), hostId: row["host_id"] as Id, who: String(row["name"]), startsAt: String(row["starts_at"]) })),
  };
}

import type { NoticeRow, NoticeSettings, NoticeStore, ReminderStore } from "../application/notices.ts";
import type { Notice, NoticeKind, Reminder } from "../domain/notice.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type Row = Record<string, unknown>;
const text = (r: Row, key: string) => String(r[key] ?? "");
const maybe = (r: Row, key: string) => (r[key] === null || r[key] === undefined ? null : String(r[key]));

const toNotice = (r: Row): Notice => ({
  id: text(r, "id") as Id,
  userId: text(r, "user_id") as Id,
  kind: text(r, "kind") as NoticeKind,
  taskId: text(r, "task_id") as Id,
  actorId: maybe(r, "actor_id") as Id | null,
  detail: text(r, "detail"),
  createdAt: text(r, "created_at"),
  readAt: maybe(r, "read_at"),
});

export function sqliteNoticeStore(db: Database): NoticeStore {
  const cols = "n.id, n.user_id, n.kind, n.task_id, n.actor_id, n.detail, n.created_at, n.read_at, t.title as task_title, t.due_on, coalesce(u.name, '') as actor_name";
  const from = "from notice n join task t on t.id = n.task_id left join user u on u.id = n.actor_id";
  const insert = db.prepare("insert into notice (id, user_id, kind, task_id, actor_id, detail, created_at, read_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  const forUser = db.prepare(`select ${cols} ${from} where n.user_id = ? order by n.created_at desc, n.rowid desc limit ?`);
  const unreadFor = db.prepare(`select ${cols} ${from} where n.user_id = ? and n.read_at is null order by n.created_at desc, n.rowid desc limit ?`);
  const unreadCount = db.prepare("select count(*) as n from notice where user_id = ? and read_at is null");
  const get = db.prepare("select id, user_id, kind, task_id, actor_id, detail, created_at, read_at from notice where id = ?");
  const markRead = db.prepare("update notice set read_at = ? where id = ? and read_at is null");
  const markAll = db.prepare("update notice set read_at = ? where user_id = ? and read_at is null");
  const toEmail = db.prepare(`select ${cols} ${from} join notice_setting s on s.user_id = n.user_id and s.email = 1 where n.emailed_at is null and n.read_at is null order by n.created_at, n.rowid`);
  const markEmailed = db.prepare("update notice set emailed_at = ? where id in (select value from json_each(?))");
  const markAllEmailed = db.prepare("update notice set emailed_at = ? where user_id = ? and emailed_at is null");
  const row = (r: Row): NoticeRow => ({ ...toNotice(r), taskTitle: text(r, "task_title"), actorName: text(r, "actor_name"), dueOn: maybe(r, "due_on") });
  return {
    insert: (n) => void insert.run(n.id, n.userId, n.kind, n.taskId, n.actorId, n.detail.slice(0, 200), n.createdAt, n.readAt),
    forUser: (userId, limit) => (forUser.all(userId, limit) as Row[]).map(row),
    unreadFor: (userId, limit) => (unreadFor.all(userId, limit) as Row[]).map(row),
    unreadCount: (userId) => Number((unreadCount.get(userId) as Row)["n"]),
    get(id) {
      const found = get.get(id) as Row | undefined;
      return found ? toNotice(found) : null;
    },
    markRead: (id, at) => void markRead.run(at, id),
    markAllRead: (userId, at) => Number(markAll.run(at, userId).changes),
    toEmail: () => (toEmail.all() as Row[]).map(row),
    markEmailed: (ids, at) => void markEmailed.run(at, JSON.stringify(ids)),
    markAllEmailed: (userId, at) => void markAllEmailed.run(at, userId),
  };
}

const toReminder = (r: Row): Reminder => ({
  id: text(r, "id") as Id,
  taskId: text(r, "task_id") as Id,
  userId: text(r, "user_id") as Id,
  at: maybe(r, "at"),
  daysBefore: r["days_before"] === null || r["days_before"] === undefined ? null : Number(r["days_before"]),
  time: maybe(r, "time_of_day"),
  forWhom: text(r, "for_whom") === "assignee" ? "assignee" : "me",
  carry: r["carry"] === 1,
  sentAt: maybe(r, "sent_at"),
  sentForDue: maybe(r, "sent_for_due"),
});

export function sqliteTaskReminderStore(db: Database): ReminderStore {
  const cols = "id, task_id, user_id, at, days_before, time_of_day, for_whom, carry, sent_at, sent_for_due";
  const insert = db.prepare(`insert into task_reminder (${cols}, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const get = db.prepare(`select ${cols} from task_reminder where id = ?`);
  const remove = db.prepare("delete from task_reminder where id = ?");
  const forTask = db.prepare(`select ${cols} from task_reminder where task_id = ? and (user_id = ? or for_whom = 'assignee') order by created_at, rowid`);
  const carried = db.prepare(`select ${cols} from task_reminder where task_id = ? and carry = 1 order by created_at, rowid`);
  const pending = db.prepare(`select r.id, r.task_id, r.user_id, r.at, r.days_before, r.time_of_day, r.for_whom, r.carry, r.sent_at, r.sent_for_due from task_reminder r join task t on t.id = r.task_id where t.status <> 'done' and ((r.at is not null and r.sent_at is null) or r.days_before is not null)`);
  const markSent = db.prepare("update task_reminder set sent_at = ?, sent_for_due = ? where id = ?");
  return {
    insert: (r, at) => void insert.run(r.id, r.taskId, r.userId, r.at, r.daysBefore, r.time, r.forWhom, r.carry ? 1 : 0, r.sentAt, r.sentForDue, at),
    carried: (taskId) => (carried.all(taskId) as Row[]).map(toReminder),
    get(id) {
      const found = get.get(id) as Row | undefined;
      return found ? toReminder(found) : null;
    },
    remove: (id) => void remove.run(id),
    forTask: (taskId, userId) => (forTask.all(taskId, userId) as Row[]).map(toReminder),
    pending: () => (pending.all() as Row[]).map(toReminder),
    markSent: (id, at, forDue) => void markSent.run(at, forDue, id),
  };
}

export function sqliteNoticeSettings(db: Database): NoticeSettings {
  const get = db.prepare("select email from notice_setting where user_id = ?");
  const set = db.prepare("insert into notice_setting (user_id, email, updated_at) values (?, ?, ?) on conflict (user_id) do update set email = excluded.email, updated_at = excluded.updated_at");
  return {
    emailOf: (userId) => (get.get(userId) as Row | undefined)?.["email"] === 1,
    setEmail: (userId, on, at) => void set.run(userId, on ? 1 : 0, at),
  };
}

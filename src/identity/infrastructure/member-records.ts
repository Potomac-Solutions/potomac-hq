// A member's records across HQ, for removing them (decision 0025): what open
// work they hold, handing it to someone else, and deleting what was only
// theirs. History that names them (the activity log, time, money, notes,
// comments, files and every "made by") is never touched here.
import type { MemberRecords, OpenWork } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

/** Tables holding only a person's own things, deleted with them. Order matters only for the filter a feed points at. */
const ONLY_THEIRS: readonly (readonly [table: string, column: string])[] = [
  ["calendar_feed", "user_id"],
  ["user_preference", "user_id"],
  ["two_factor_recovery", "user_id"],
  ["two_factor_session", "user_id"],
  ["user_two_factor", "user_id"],
  ["passkey_challenge", "user_id"],
  ["passkey", "user_id"],
  ["work_view", "user_id"],
  ["task_reminder", "user_id"],
  ["notice", "user_id"],
  ["notice_setting", "user_id"],
  ["task_import", "user_id"],
  ["undo_stash", "user_id"],
  ["assistant_message", "user_id"],
  ["assistant_action", "user_id"],
  ["assistant_preference", "user_id"],
  ["nav_pin", "user_id"],
  ["push_queue", "user_id"],
  ["push_subscription", "user_id"],
  ["morning_email_sent", "user_id"],
];

const minutesBetween = (from: string, to: string): number => Math.min(1440, Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 60_000)));

export function sqliteMemberRecords(db: Database): MemberRecords {
  const n = (sql: string, ...args: (string | number)[]) => Number(db.prepare(sql).get(...args)?.["n"] ?? 0);
  const changes = (sql: string, ...args: (string | number)[]) => Number(db.prepare(sql).run(...args).changes);
  const open = {
    deals: "from opportunity where owner_id = ? and stage not in ('won', 'lost')",
    projects: "from project where owner_id = ? and status = 'active'",
    tasks: "from task where assignee_id = ? and status <> 'done' and project_id is not null",
    todos: "from task where assignee_id = ? and status <> 'done' and project_id is null",
    calls: "from booking where host_id = ? and status = 'booked' and starts_at > ?",
    sharedFilters: "from saved_filter where owner_id = ? and shared = 1",
    timers: "from time_entry where user_id = ? and minutes is null and removed_at is null",
  };
  const running = db.prepare("select id, started_at from time_entry where user_id = ? and minutes is null and removed_at is null");
  const stop = db.prepare("update time_entry set minutes = ?, updated_at = ? where id = ?");
  return {
    openWork(userId, now) {
      return {
        deals: n(`select count(*) as n ${open.deals}`, userId),
        projects: n(`select count(*) as n ${open.projects}`, userId),
        tasks: n(`select count(*) as n ${open.tasks}`, userId),
        todos: n(`select count(*) as n ${open.todos}`, userId),
        calls: n(`select count(*) as n ${open.calls}`, userId, now),
        bookingHost: n("select count(*) as n from booking_setting where host_id = ?", userId) > 0,
        sharedFilters: n(`select count(*) as n ${open.sharedFilters}`, userId),
        timers: n(`select count(*) as n ${open.timers}`, userId),
      };
    },
    handOver(from: Id, to: Id, now: string): OpenWork {
      const timers = running.all(from) as { id: string; started_at: string | null }[];
      for (const timer of timers) stop.run(timer.started_at ? minutesBetween(timer.started_at, now) : 1, now, timer.id);
      return {
        deals: changes("update opportunity set owner_id = ?, updated_at = ? where owner_id = ? and stage not in ('won', 'lost')", to, now, from),
        projects: changes("update project set owner_id = ?, updated_at = ? where owner_id = ? and status = 'active'", to, now, from),
        tasks: changes("update task set assignee_id = ?, updated_at = ? where assignee_id = ? and status <> 'done' and project_id is not null", to, now, from),
        todos: changes("update task set assignee_id = ?, updated_at = ? where assignee_id = ? and status <> 'done' and project_id is null", to, now, from),
        calls: changes("update booking set host_id = ? where host_id = ? and status = 'booked' and starts_at > ?", to, from, now),
        bookingHost: changes("update booking_setting set host_id = ? where host_id = ?", to, from) > 0,
        sharedFilters: changes("update saved_filter set owner_id = ?, updated_at = ? where owner_id = ? and shared = 1", to, now, from),
        timers: timers.length,
      };
    },
    forget(userId) {
      for (const [table, column] of ONLY_THEIRS) db.prepare(`delete from ${table} where ${column} = ?`).run(userId);
      db.prepare("delete from saved_filter where owner_id = ? and shared = 0").run(userId);
    },
  };
}

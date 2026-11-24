// Notices and reminders (decision 0007, section 8).
//
// A notice is something new for one person: a task given to them, a comment
// that mentions them, or a reminder they set coming due. They show under the
// bell in the header and on Today. Anyone with `task.view` has notices.
//
// Assignments and mentions come from the events other modules record:
// `withNotices` wraps an activity log so each event appended makes its
// notices in the same transaction. Reminders are fired by a job every minute.
// A person may also have their notices emailed, when email is set up.
import { carriedTiming, firesAt, isReminderDue, noticesFromEvent, readReminder, reminderRecipient, reminderText, type Notice, type NoticeKind, type Reminder, type ReminderError, type ReminderInput } from "../domain/notice.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, friendlyDay, ok, recordActivity, type ActivityDeps, type ActivityLog, type Clock, type Id, type IdSource, type Result, type Transact } from "../../shared/index.ts";

export type NoticeRow = Notice & { readonly taskTitle: string; /** "BDW-12" (decision 0008, section 1). */ readonly taskRef: string; readonly actorName: string; readonly dueOn: string | null };

export type NoticeStore = {
  insert(notice: Notice): void;
  /** One person's notices, newest first. */
  forUser(userId: Id, limit: number): NoticeRow[];
  /** Their unread notices, newest first. */
  unreadFor(userId: Id, limit: number): NoticeRow[];
  unreadCount(userId: Id): number;
  get(id: Id): Notice | null;
  markRead(id: Id, at: string): void;
  /** How many were marked. */
  markAllRead(userId: Id, at: string): number;
  /** Notices not yet emailed, for people who want them emailed, oldest first. */
  toEmail(): NoticeRow[];
  markEmailed(ids: readonly Id[], at: string): void;
  /** Marks all of one person's notices as emailed, so turning email on sends only what's new from then. */
  markAllEmailed(userId: Id, at: string): void;
};

export type ReminderStore = {
  insert(reminder: Reminder, at: string): void;
  get(id: Id): Reminder | null;
  remove(id: Id): void;
  /** The reminders one person sees on a task: their own, and every one for whoever has it. */
  forTask(taskId: Id, userId: Id): Reminder[];
  /** A task's reminders that carry over to the next of a repeat. */
  carried(taskId: Id): Reminder[];
  /** Every reminder that might fire: ones at a time not yet sent, and every one before a due date. */
  pending(): Reminder[];
  markSent(id: Id, at: string, forDue: string | null): void;
};

export type NoticeSettings = {
  /** Whether they have their notices emailed. Off unless they turned it on. */
  emailOf(userId: Id): boolean;
  setEmail(userId: Id, on: boolean, at: string): void;
};

/** What notices need to know about a task, from the projects module. */
export type TaskLookup = (taskId: Id) => { readonly title: string; readonly dueOn: string | null; readonly done: boolean; readonly assigneeId: Id | null } | null;

export type NoticesDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly notices: NoticeStore;
  readonly reminders: ReminderStore;
  readonly settings: NoticeSettings;
  readonly task: TaskLookup;
  /** The business time zone, for reminder times. */
  readonly zone: string;
  /** Whether outbound email is set up, so the setting can say if it will work. */
  readonly emailReady: boolean;
};

type Refused = "forbidden" | "not-found";
const allowed = (deps: Pick<NoticesDeps, "users">, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "task.view").ok;

/**
 * An activity log that also does what each event calls for here, in the same
 * transaction as the event: the notices it makes, and, when a repeating task
 * makes its next one, carrying the reminders marked to carry. Wire it where
 * tasks, to-dos and comments are recorded.
 */
export function withNotices(log: ActivityLog, deps: { readonly notices: NoticeStore; readonly reminders: ReminderStore; readonly newId: IdSource; readonly clock: Clock; readonly zone: string }): ActivityLog {
  return {
    append(event) {
      log.append(event);
      for (const draft of noticesFromEvent(event)) deps.notices.insert({ ...draft, id: deps.newId(), createdAt: event.occurredAt, readAt: null });
      if (event.action === "task.repeated" && typeof event.context["previousId"] === "string") {
        const oldDue = typeof event.context["previousDueOn"] === "string" ? event.context["previousDueOn"] : null;
        const newDue = typeof event.context["dueOn"] === "string" ? event.context["dueOn"] : null;
        for (const reminder of deps.reminders.carried(event.context["previousId"] as Id)) {
          const timing = carriedTiming(reminder, oldDue, newDue, deps.zone);
          if (timing) deps.reminders.insert({ ...reminder, ...timing, id: deps.newId(), taskId: event.recordId, sentAt: null, sentForDue: null }, event.occurredAt);
        }
      }
    },
  };
}

/** The task as a notice names it: BDW-12 “Build the homepage”. */
const named = (row: NoticeRow) => `${row.taskRef ? `${row.taskRef} ` : ""}“${row.taskTitle}”`;

const KIND_TEXT: Record<NoticeKind, (row: NoticeRow) => string> = {
  assigned: (row) => `${row.actorName || "Someone"} gave you ${named(row)}`,
  mentioned: (row) => `${row.actorName || "Someone"} mentioned you on ${named(row)}`,
  reminder: (row) => `Reminder: ${named(row)}`,
};

export type NoticeLine = { readonly id: string; readonly kind: string; readonly text: string; readonly detail: string; readonly href: string; readonly when: string; readonly unread: boolean };

const line = (row: NoticeRow, formatWhen: (at: string) => string): NoticeLine => ({
  id: row.id,
  kind: row.kind,
  text: KIND_TEXT[row.kind](row),
  detail: row.detail,
  href: `/notices/${row.id}`,
  when: formatWhen(row.createdAt),
  unread: row.readAt === null,
});

export type NoticesView = { readonly items: readonly NoticeLine[]; readonly unread: number; readonly email: boolean; readonly emailReady: boolean };

/** Your notices, newest first. */
export function listNotices(deps: NoticesDeps, actorId: Id | null, formatWhen: (at: string) => string): Result<NoticesView, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return ok({ items: deps.notices.forUser(actorId, 100).map((row) => line(row, formatWhen)), unread: deps.notices.unreadCount(actorId), email: deps.settings.emailOf(actorId), emailReady: deps.emailReady });
}

/** Your unread notices, for Today. Empty without permission. */
export function unreadNotices(deps: NoticesDeps, actorId: Id | null, formatWhen: (at: string) => string): readonly NoticeLine[] {
  return allowed(deps, actorId) ? deps.notices.unreadFor(actorId, 10).map((row) => line(row, formatWhen)) : [];
}

/** How many you haven't seen, for the bell. */
export const unreadCount = (deps: NoticesDeps, actorId: Id | null): number => (allowed(deps, actorId) ? deps.notices.unreadCount(actorId) : 0);

/** Marks one of your notices read and says where it leads. */
export function openNotice(deps: NoticesDeps, actorId: Id | null, noticeId: Id): Result<string, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const notice = deps.notices.get(noticeId);
  if (!notice || notice.userId !== actorId) return err("not-found");
  if (notice.readAt === null) deps.notices.markRead(noticeId, deps.clock());
  return ok(`/tasks/${notice.taskId}${notice.kind === "mentioned" ? "#comments" : ""}`);
}

export function markAllNoticesRead(deps: NoticesDeps, actorId: Id | null): Result<number, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return ok(deps.notices.markAllRead(actorId, deps.clock()));
}

/** Turns emailing your notices on or off. Turned on, it sends what comes from then on, not what's already here. */
export function setNoticeEmail(deps: NoticesDeps, actorId: Id | null, on: boolean): Result<boolean, "forbidden" | "unchanged"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    if (deps.settings.emailOf(actorId) === on) return err("unchanged");
    deps.settings.setEmail(actorId, on, deps.clock());
    if (on) deps.notices.markAllEmailed(actorId, deps.clock());
    recordActivity(deps, { actorId, action: on ? "user.notice-email-on" : "user.notice-email-off", recordType: "user", recordId: actorId, context: {} });
    return ok(on);
  });
}

export type ReminderLine = { readonly id: string; readonly text: string; readonly fires: string; /** "For you", or "For whoever has it". */ readonly who: string; readonly carry: boolean; readonly canRemove: boolean };

/** Your reminders on a task. */
export function remindersOn(deps: NoticesDeps, actorId: Id | null, taskId: Id, formatWhen: (at: string) => string): readonly ReminderLine[] {
  if (!allowed(deps, actorId)) return [];
  const task = deps.task(taskId);
  return deps.reminders.forTask(taskId, actorId).map((reminder) => {
    const when = firesAt(reminder, task?.dueOn ?? null, deps.zone);
    const sent = reminder.at ? reminder.sentAt !== null : reminder.sentForDue !== null && reminder.sentForDue === task?.dueOn;
    return {
      id: reminder.id,
      text: reminderText(reminder, deps.zone),
      fires: sent ? "Sent" : when ? `Fires ${formatWhen(when.toString())}` : "Fires once it has a due date",
      who: reminder.forWhom === "assignee" ? "For whoever has it" : reminder.userId === actorId ? "For you" : "",
      carry: reminder.carry,
      canRemove: mayRemove(deps, actorId, reminder),
    };
  });
}

/** A reminder's setter may remove it; one for whoever has the task, anyone who edits tasks may too. */
const mayRemove = (deps: NoticesDeps, actorId: Id, reminder: Reminder): boolean => reminder.userId === actorId || (reminder.forWhom === "assignee" && authorize(deps, actorId, "task.edit").ok);

/** Sets a reminder on a task you can see, for you or for whoever has it. */
export function addReminder(deps: NoticesDeps, actorId: Id | null, taskId: Id, input: ReminderInput): Result<Reminder, Refused | ReminderError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const task = deps.task(taskId);
    if (!task) return err("not-found");
    const read = readReminder(input, deps.zone, Temporal.Instant.from(deps.clock()));
    if (!read.ok) return read;
    const reminder: Reminder = { id: deps.newId(), taskId, userId: actorId, ...read.value, sentAt: null, sentForDue: null };
    deps.reminders.insert(reminder, deps.clock());
    recordActivity(deps, { actorId, action: "reminder.added", recordType: "task", recordId: taskId, context: { title: task.title, when: reminderText(reminder, deps.zone), forWhom: reminder.forWhom, carry: reminder.carry } });
    return ok(reminder);
  });
}

/** Removes a reminder: your own, or one for whoever has the task if you edit tasks. */
export function removeReminder(deps: NoticesDeps, actorId: Id | null, reminderId: Id): Result<Reminder, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const reminder = deps.reminders.get(reminderId);
    if (!reminder || !mayRemove(deps, actorId, reminder)) return err("not-found");
    deps.reminders.remove(reminderId);
    recordActivity(deps, { actorId, action: "reminder.removed", recordType: "task", recordId: reminder.taskId, context: { when: reminderText(reminder, deps.zone) } });
    return ok(reminder);
  });
}

/** Fires every reminder that has come due: a notice for its owner, once. Returns how many fired. */
export function fireReminders(deps: NoticesDeps): number {
  return deps.transact(() => {
    const at = deps.clock();
    const now = Temporal.Instant.from(at);
    let fired = 0;
    for (const reminder of deps.reminders.pending()) {
      const task = deps.task(reminder.taskId);
      if (!task || !isReminderDue(reminder, task, now, deps.zone)) continue;
      const to = reminderRecipient(reminder, task.assigneeId);
      if (deps.users.get(to)?.status !== "active") continue;
      deps.notices.insert({ id: deps.newId(), userId: to, kind: "reminder", taskId: reminder.taskId, actorId: null, detail: task.dueOn ? `Due ${friendlyDay(task.dueOn, now.toZonedDateTimeISO(deps.zone).toPlainDate().toString())}` : "", createdAt: at, readAt: null });
      deps.reminders.markSent(reminder.id, at, task.dueOn);
      recordActivity(deps, { actorId: null, action: "reminder.fired", recordType: "task", recordId: reminder.taskId, context: { userId: to, title: task.title } });
      fired += 1;
    }
    return fired;
  });
}

export type NoticeMail = (message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>;

/** Emails each person who wants it their new notices, one email each. Each is marked before it goes, so a restart never sends it twice. */
export async function emailNotices(deps: NoticesDeps, mail: NoticeMail, options: { readonly publicUrl: string }): Promise<{ readonly sent: number; readonly failed: number }> {
  const base = options.publicUrl.replace(/\/$/, "");
  const byUser = new Map<Id, NoticeRow[]>();
  for (const row of deps.notices.toEmail()) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  let sent = 0;
  let failed = 0;
  for (const [userId, rows] of byUser) {
    const user = deps.users.get(userId);
    deps.notices.markEmailed(rows.map((row) => row.id), deps.clock());
    if (!user || user.status !== "active" || !user.email) continue;
    const lines = rows.flatMap((row) => [KIND_TEXT[row.kind](row), ...(row.detail ? [`  ${row.detail}`] : []), `  ${base}/notices/${row.id}`, ""]);
    const subject = rows.length === 1 ? KIND_TEXT[(rows[0] as NoticeRow).kind](rows[0] as NoticeRow) : `${rows.length} new notices in HQ`;
    const body = [...lines, `All your notices: ${base}/notices`, "", "To stop these, turn off emailed notices on your Notices page."].join("\n");
    if (await mail({ to: user.email, subject, body })) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

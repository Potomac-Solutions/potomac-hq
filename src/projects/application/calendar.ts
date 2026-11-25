// The calendar feed (decision 0007, section 10). Each person may have one
// private address that a calendar app subscribes to: their open tasks with a
// due date, and the open milestones of the active projects they're on, as
// all-day events. It can follow one of their saved filters instead. The
// address is shown once and only its hash kept; making a new one stops the
// old. It is read-only: nothing in the calendar comes back to HQ.
//
// It is one of the few things HQ serves without a signed-in person, so the
// address carries the secret, and the feed still checks that its person is
// active and may see tasks.
import { allDayCalendar, type AllDayEvent } from "../../shared/index.ts";
import { mayUse } from "../domain/saved-filter.ts";
import { matchesFilter, readFilter } from "../domain/work-filter.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { ProjectsDeps } from "./commands.ts";

const allowed = (deps: ProjectsDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "task.view").ok && authorize(deps, actorId, "project.view").ok;

export type CalendarFeedView = {
  /** They have an address. Its secret can't be shown again. */
  readonly on: boolean;
  /** The saved filter it follows, or empty. */
  readonly filterName: string;
  readonly made: string;
  /** When a calendar last fetched it, or empty. */
  readonly lastUsed: string;
  /** Saved filters it could follow: theirs, and shared ones. */
  readonly filters: readonly { readonly value: string; readonly label: string; readonly on: boolean }[];
};

export function calendarFeedView(deps: ProjectsDeps, actorId: Id | null): Result<CalendarFeedView, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const feed = deps.feeds.forUser(actorId);
  const filters = deps.work.filtersFor(actorId).filter((one) => mayUse(one, actorId));
  return ok({
    on: feed !== null,
    filterName: (feed?.filterId && filters.find((one) => one.id === feed.filterId)?.name) || "",
    made: feed ? deps.formatWhen(feed.createdAt) : "",
    lastUsed: feed?.lastUsedAt ? deps.formatWhen(feed.lastUsedAt) : "",
    filters: filters.map((one) => ({ value: one.id, label: one.name, on: one.id === feed?.filterId })),
  });
}

/** Makes your address, replacing any you had. Answers the secret, to be shown once. */
export function makeCalendarFeed(deps: ProjectsDeps, actorId: Id | null, filterId: Id | null): Result<{ readonly token: string; readonly replaced: boolean }, "forbidden" | "not-found"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    if (filterId) {
      const filter = deps.work.getFilter(filterId);
      if (!filter || !mayUse(filter, actorId)) return err("not-found");
    }
    const replaced = deps.feeds.forUser(actorId) !== null;
    const token = deps.feedTokens.newToken();
    deps.feeds.save({ userId: actorId, tokenHash: deps.feedTokens.hash(token), filterId, createdAt: deps.clock(), lastUsedAt: null });
    recordActivity(deps, { actorId, action: "calendar.feed-made", recordType: "user", recordId: actorId, context: { replaced, ...(filterId ? { filterId } : {}) } });
    return ok({ token, replaced });
  });
}

/** Stops your address. */
export function stopCalendarFeed(deps: ProjectsDeps, actorId: Id | null): Result<true, "forbidden" | "not-found"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    if (!deps.feeds.forUser(actorId)) return err("not-found");
    deps.feeds.remove(actorId);
    recordActivity(deps, { actorId, action: "calendar.feed-stopped", recordType: "user", recordId: actorId, context: {} });
    return ok(true);
  });
}

/**
 * The calendar for an address, or null if it isn't one, or its person may no
 * longer see tasks. `publicUrl` makes each event's link back to HQ.
 */
export function calendarFor(deps: ProjectsDeps, token: string, publicUrl: string): string | null {
  const feed = deps.feeds.byHash(deps.feedTokens.hash(token));
  if (!feed) return null;
  const user = deps.users.get(feed.userId);
  if (!user || user.status !== "active" || !allowed(deps, feed.userId)) return null;
  const today = deps.today();
  const base = publicUrl.replace(/\/$/, "");
  const rows = deps.work.rows();
  const filter = feed.filterId ? deps.work.getFilter(feed.filterId) : null;
  const usable = filter && mayUse(filter, feed.userId) ? filter : null;
  const picked = usable
    ? (() => {
        const query = new URLSearchParams(usable.query);
        const read = readFilter((name) => query.getAll(name));
        const labels = deps.labels.forTasks(rows.map((row) => row.id));
        return rows.filter((row) => matchesFilter({ ...row, labelIds: (labels.get(row.id) ?? []).map((label) => label.id) }, read, { today, viewerId: feed.userId }));
      })()
    : rows.filter((row) => row.assigneeId === feed.userId && row.status !== "done");
  const events: AllDayEvent[] = picked
    .filter((row) => row.dueOn !== null)
    .map((row) => ({
      uid: `task-${row.id}@potomac-hq`,
      summary: row.status === "done" ? `Done: ${row.title}` : row.title,
      description: [row.projectName ? `${row.projectName}${row.clientName ? `, for ${row.clientName}` : ""}` : "A to-do", `Open it in HQ: ${base}/tasks/${row.id}`].join("\n"),
      url: `${base}/tasks/${row.id}`,
      start: row.startOn !== null && row.startOn < (row.dueOn as string) ? row.startOn : (row.dueOn as string),
      end: row.dueOn as string,
    }));
  if (!usable) {
    // The milestones of active projects they're on: ones they own, or have a task in.
    const theirs = new Set(rows.filter((row) => row.projectId !== null && row.assigneeId === feed.userId).map((row) => row.projectId as Id));
    for (const project of deps.projects.list()) {
      if (project.status !== "active" || (project.ownerId !== feed.userId && !theirs.has(project.id))) continue;
      for (const milestone of deps.milestones.listFor(project.id)) {
        if (milestone.dueOn === null || milestone.doneOn !== null) continue;
        events.push({
          uid: `milestone-${milestone.id}@potomac-hq`,
          summary: `Milestone: ${milestone.name}`,
          description: `${project.name}, for ${project.clientName}\nOpen it in HQ: ${base}/projects/${project.id}#milestones`,
          url: `${base}/projects/${project.id}`,
          start: milestone.dueOn,
          end: milestone.dueOn,
        });
      }
    }
  }
  // Booked calls they host, at their times (quality of life, 2026-11-25).
  if (!usable) events.push(...(deps.bookedCalls?.(feed.userId as Id, base) ?? []));
  deps.feeds.used(feed.userId, deps.clock());
  const name = usable ? `HQ: ${usable.name}` : `HQ: ${user.name.split(/\s+/)[0] ?? user.name}'s work`;
  return allDayCalendar(name, events, deps.clock());
}

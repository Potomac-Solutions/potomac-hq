// Scheduling invites: Potomac asks someone in the portal to paint the half
// hours they could do over a few days, within Potomac's own free time, then
// confirms one start, which books the call. Like a Timeful poll for two.
// Permissions: `booking.manage` to invite, confirm and cancel; `call.respond`
// to see them. The invitee answers through the portal, which passes who they
// are; every lookup goes through their organization.
import { cellsFromRanges, gridRows, rangesOn } from "../domain/grid.ts";
import { clockLabel, type Busy, type DayRange, type Weekday } from "../domain/hours.ts";
import { INVITE_STATUS_LABELS, inviteDays, newInvite, startsFreeForBoth, type InviteError, type InviteInput, type ScheduleInvite } from "../domain/invite.ts";
import type { Booking } from "../domain/booking.ts";
import { layGrid, SHORT_DAYS, type BookingDeps, type GridView } from "./booking.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { ClientPeople, ScheduleInviteStore } from "./ports.ts";

export type InviteDeps = BookingDeps & { readonly invites: ScheduleInviteStore; readonly people: ClientPeople };
type Refused = "forbidden" | "not-found";
const allowed = (deps: BookingDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;
const HALF_HOUR_MS = 30 * 60_000;

/** A half hour's start on a day, in UTC. */
export const cellStart = (deps: BookingDeps, day: Temporal.PlainDate, at: number) => day.toPlainDateTime({ hour: Math.floor(at / 60), minute: at % 60 }).toZonedDateTime(deps.timeZone, { disambiguation: "earlier" }).toInstant();

/**
 * Potomac's free half hours over an invite's days: painted free (the day's
 * own painting, or its weekday's), not a day off, not busy in the calendar,
 * no call booked, and not already past.
 */
export async function hostFree(deps: BookingDeps, invite: Pick<ScheduleInvite, "firstDay" | "lastDay">): Promise<{ readonly free: ReadonlySet<string>; readonly failed: boolean; readonly rangesOf: (day: Temporal.PlainDate) => readonly DayRange[] }> {
  const days = inviteDays(invite);
  const settings = deps.bookings.settings();
  const hours = settings?.hours ?? [];
  const painted = deps.bookings.paintedDates(invite.firstDay);
  const closed = new Set(deps.bookings.closedDays(invite.firstDay).map((one) => one.day));
  const rangesOf = (day: Temporal.PlainDate): readonly DayRange[] => (closed.has(day.toString()) ? [] : (painted[day.toString()] ?? rangesOn(hours, day.dayOfWeek as Weekday)));
  const from = cellStart(deps, days[0] as Temporal.PlainDate, 0).toString();
  const to = cellStart(deps, (days.at(-1) as Temporal.PlainDate).add({ days: 1 }), 0).toString();
  let busy: readonly Busy[] = [];
  let failed = false;
  try {
    busy = await deps.busy.busy(from, to);
  } catch {
    failed = true;
  }
  const taken = [...busy, ...deps.bookings.booked(from, to)].map((one) => ({ start: Temporal.Instant.from(one.start).epochMilliseconds, end: Temporal.Instant.from(one.end).epochMilliseconds }));
  const now = Temporal.Instant.from(deps.clock()).epochMilliseconds;
  const free = new Set<string>();
  for (const day of days) {
    for (const at of cellsFromRanges(rangesOf(day))) {
      const start = cellStart(deps, day, at);
      const ms = start.epochMilliseconds;
      if (ms < now) continue;
      if (taken.some((one) => ms < one.end && ms + HALF_HOUR_MS > one.start)) continue;
      free.add(start.toString());
    }
  }
  return { free, failed, rangesOf };
}

/** Invites someone in the portal to paint the times they could do. Permission: `booking.manage`. */
export function createInvite(deps: InviteDeps, actorId: Id | null, clientUserId: Id, input: InviteInput): Result<ScheduleInvite, Refused | InviteError | "no-access"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const person = deps.people.get(clientUserId);
  if (!person) return err("not-found");
  if (!person.active) return err("no-access");
  const today = Temporal.Instant.from(deps.clock()).toZonedDateTimeISO(deps.timeZone).toPlainDate().toString();
  return deps.transact(() => {
    const made = newInvite({ id: deps.newId(), organizationId: person.organizationId, clientUserId, createdBy: actorId }, input, today);
    if (!made.ok) return made;
    deps.invites.insert(made.value, deps.clock());
    recordActivity(deps, { actorId, action: "schedule-invite.sent", recordType: "schedule-invite", recordId: made.value.id, context: { organizationId: person.organizationId, clientUserId } });
    return ok(made.value);
  });
}

/** Withdraws an open invite. Permission: `booking.manage`. */
export function cancelInvite(deps: InviteDeps, actorId: Id | null, id: Id): Result<ScheduleInvite, Refused | "not-open"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.invites.get(id);
    if (!found) return err("not-found");
    if (found.status !== "open") return err("not-open");
    const gone = { ...found, status: "cancelled" as const };
    deps.invites.update(gone, deps.clock());
    recordActivity(deps, { actorId, action: "schedule-invite.cancelled", recordType: "schedule-invite", recordId: id, context: { organizationId: found.organizationId } });
    return ok(gone);
  });
}

export type Guest = { readonly organizationId: Id; readonly clientUserId: Id };
export const theirs = (deps: InviteDeps, guest: Guest, id: Id) => {
  const found = deps.invites.get(id);
  return found && found.organizationId === guest.organizationId ? found : null;
};

/**
 * The invitee's answer: the half hours they could do. Only Potomac's free
 * half hours are kept. Answering again replaces the last answer.
 */
export async function answerInvite(deps: InviteDeps, guest: Guest, id: Id, form: Readonly<Record<string, string>>): Promise<Result<ScheduleInvite, "not-found" | "not-open" | "calendar-failed">> {
  const found = theirs(deps, guest, id);
  if (!found) return err("not-found");
  if (found.status !== "open") return err("not-open");
  const host = await hostFree(deps, found);
  if (host.failed) return err("calendar-failed");
  const chosen: string[] = [];
  for (const day of inviteDays(found)) {
    const prefix = `c-${day.toString()}-`;
    for (const [key, value] of Object.entries(form)) {
      if (!key.startsWith(prefix) || value !== "1") continue;
      const at = Number(key.slice(prefix.length));
      if (!Number.isInteger(at) || at < 0 || at >= 24 * 60 || at % 30 !== 0) continue;
      const start = cellStart(deps, day, at).toString();
      if (host.free.has(start)) chosen.push(start);
    }
  }
  return deps.transact(() => {
    const answered = { ...found, answeredAt: deps.clock() };
    deps.invites.setCells(found.id, chosen);
    deps.invites.update(answered, deps.clock());
    recordActivity(deps, { actorId: null, action: "schedule-invite.answered", recordType: "schedule-invite", recordId: found.id, context: { organizationId: found.organizationId, clientUserId: guest.clientUserId, halfHours: chosen.length } });
    return ok(answered);
  });
}

/**
 * Books one of the times free for both. Permission: `booking.manage`. The
 * call goes on the host's calendar, as a client's call.
 */
export async function confirmInvite(deps: InviteDeps, actorId: Id | null, id: Id, start: string): Promise<Result<{ readonly invite: ScheduleInvite; readonly booking: Booking }, Refused | "not-open" | "taken" | "calendar-failed" | "no-host" | "no-access">> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const found = deps.invites.get(id);
  if (!found) return err("not-found");
  if (found.status !== "open") return err("not-open");
  const settings = deps.bookings.settings();
  if (!settings) return err("no-host");
  const person = deps.people.get(found.clientUserId);
  if (!person || !person.active) return err("no-access");
  const host = await hostFree(deps, found);
  if (host.failed) return err("calendar-failed");
  let when: Temporal.Instant;
  try {
    when = Temporal.Instant.from(start);
  } catch {
    return err("taken");
  }
  if (!startsFreeForBoth(host.free, deps.invites.cells(found.id), found.minutes).includes(when.toString())) return err("taken");
  return deps.transact(() => {
    const booking: Booking = {
      id: deps.newId(),
      kind: "client",
      status: "booked",
      start: when.toString(),
      end: when.add({ minutes: found.minutes }).toString(),
      name: person.name,
      email: person.email,
      phone: "",
      topic: found.title,
      organizationId: found.organizationId,
      clientUserId: found.clientUserId,
      hostId: settings.hostId,
      createdAt: deps.clock(),
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: "",
    };
    deps.bookings.add(booking, null);
    const confirmed = { ...found, status: "confirmed" as const, bookingId: booking.id };
    deps.invites.update(confirmed, deps.clock());
    recordActivity(deps, { actorId, action: "booking.made", recordType: "booking", recordId: booking.id, context: { kind: "client", start: booking.start, organizationId: found.organizationId, from: "invite" } });
    recordActivity(deps, { actorId, action: "schedule-invite.confirmed", recordType: "schedule-invite", recordId: found.id, context: { organizationId: found.organizationId, start: booking.start } });
    return ok({ invite: confirmed, booking });
  });
}

// ── What the pages show ────────────────────────────────────────────────

export type InviteLine = { readonly id: string; readonly title: string; readonly who: string; readonly organizationId: string; readonly days: string; readonly status: ScheduleInvite["status"]; readonly statusLabel: string; readonly answered: boolean; readonly length: string };

const dayRange = (invite: ScheduleInvite) => {
  const first = Temporal.PlainDate.from(invite.firstDay);
  const last = Temporal.PlainDate.from(invite.lastDay);
  const fmt = (day: Temporal.PlainDate) => day.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return first.equals(last) ? fmt(first) : `${fmt(first)} to ${fmt(last)}`;
};

function lineOf(deps: InviteDeps, invite: ScheduleInvite): InviteLine {
  return {
    id: invite.id,
    title: invite.title,
    who: deps.people.get(invite.clientUserId)?.name ?? "Someone",
    organizationId: invite.organizationId,
    days: dayRange(invite),
    status: invite.status,
    statusLabel: invite.status === "open" && invite.answeredAt ? "Times in: confirm one" : INVITE_STATUS_LABELS[invite.status],
    answered: invite.answeredAt !== null,
    length: `${invite.minutes} minutes`,
  };
}

/** Open invites, for the Calls page. Permission: `call.respond`; empty without it. */
export function openInvites(deps: InviteDeps, actorId: Id | null): readonly InviteLine[] {
  if (!allowed(deps, actorId, "call.respond")) return [];
  return deps.invites.listOpen().map((one) => lineOf(deps, one));
}

/** A client's invites, for its page. Permission: `call.respond`. */
export function clientInvites(deps: InviteDeps, actorId: Id | null, organizationId: Id): readonly InviteLine[] {
  if (!allowed(deps, actorId, "call.respond")) return [];
  return deps.invites.listFor(organizationId).map((one) => lineOf(deps, one));
}

function inviteColumns(deps: BookingDeps, invite: ScheduleInvite) {
  const today = Temporal.Instant.from(deps.clock()).toZonedDateTimeISO(deps.timeZone).toPlainDate();
  return inviteDays(invite).map((day) => ({
    key: day.toString(),
    name: day.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    short: SHORT_DAYS[day.dayOfWeek as Weekday],
    sub: day.toLocaleString("en-US", { month: "short", day: "numeric" }),
    painted: false,
    closed: false,
    past: Temporal.PlainDate.compare(day, today) < 0,
  }));
}

/** The rows to show: from an hour before the first free half hour to an hour after the last. */
function rowsFor(invite: ScheduleInvite, rangesOf: (day: Temporal.PlainDate) => readonly DayRange[]): readonly number[] {
  const all = inviteDays(invite).flatMap((day) => rangesOf(day));
  if (all.length === 0) return gridRows([]);
  const from = Math.max(0, Math.floor((Math.min(...all.map((one) => one.start)) - 60) / 30) * 30);
  const to = Math.min(24 * 60, Math.ceil((Math.max(...all.map((one) => one.end)) + 60) / 30) * 30);
  const rows: number[] = [];
  for (let at = from; at < to; at += 30) rows.push(at);
  return rows;
}

export type StaffInviteView = {
  readonly invite: InviteLine & { readonly note: string; readonly bookingId: string };
  readonly grid: GridView;
  /** Starts free for both, in order, with labels. */
  readonly starts: readonly { readonly start: string; readonly label: string }[];
  readonly calendarFailed: boolean;
  readonly canManage: boolean;
};

/**
 * An invite as Potomac sees it: the grid with Potomac's free time and the
 * invitee's answer overlaid, and the times free for both. Permission:
 * `call.respond`.
 */
export async function staffInvite(deps: InviteDeps, actorId: Id | null, id: Id): Promise<Result<StaffInviteView, Refused>> {
  if (!allowed(deps, actorId, "call.respond")) return err("forbidden");
  const found = deps.invites.get(id);
  if (!found) return err("not-found");
  const host = await hostFree(deps, found);
  const guest = deps.invites.cells(found.id);
  const starts = found.status === "open" ? startsFreeForBoth(host.free, guest, found.minutes) : [];
  const grid = layGrid(rowsFor(found, host.rangesOf), inviteColumns(deps, found), (column, at) => {
    const start = cellStart(deps, Temporal.PlainDate.from(column.key), at).toString();
    const mine = host.free.has(start);
    const theirsToo = guest.has(start);
    const extra = mine && theirsToo ? "match" : theirsToo ? "guest" : mine ? "host" : "";
    const note = mine && theirsToo ? ", free for both" : theirsToo ? ", they can, you aren’t free" : mine ? ", you’re free" : "";
    return { on: false, busy: false, booked: false, extra, note, disabled: true };
  });
  return ok({
    invite: { ...lineOf(deps, found), note: found.note, bookingId: found.bookingId ?? "" },
    grid,
    starts: starts.map((start) => {
      const zoned = Temporal.Instant.from(start).toZonedDateTimeISO(deps.timeZone);
      return { start, label: `${zoned.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${clockLabel(zoned.hour * 60 + zoned.minute)}` };
    }),
    calendarFailed: host.failed,
    canManage: allowed(deps, actorId, "booking.manage"),
  });
}

export type GuestInviteView = {
  readonly invite: InviteLine & { readonly note: string };
  readonly grid: GridView;
  readonly freeCount: number;
  readonly calendarFailed: boolean;
};

/** An invite as the invitee sees it: Potomac's free half hours to paint over. Only their own organization's. */
export async function guestInvite(deps: InviteDeps, guest: Guest, id: Id): Promise<Result<GuestInviteView, "not-found">> {
  const found = theirs(deps, guest, id);
  if (!found) return err("not-found");
  const host = await hostFree(deps, found);
  const mine = deps.invites.cells(found.id);
  const open = found.status === "open";
  const grid = layGrid(rowsFor(found, host.rangesOf), inviteColumns(deps, found), (column, at) => {
    const start = cellStart(deps, Temporal.PlainDate.from(column.key), at).toString();
    const free = host.free.has(start);
    return { on: mine.has(start), busy: false, booked: false, extra: free ? "" : "unavailable", note: free ? "" : ", not open", disabled: !open || !free };
  });
  return ok({ invite: { ...lineOf(deps, found), note: found.note }, grid, freeCount: host.free.size, calendarFailed: host.failed });
}

/** Open invites waiting on a client, for their portal home. */
export function invitesWaitingOn(deps: InviteDeps, organizationId: Id): readonly InviteLine[] {
  return deps.invites
    .listFor(organizationId)
    .filter((one) => one.status === "open")
    .map((one) => lineOf(deps, one));
}


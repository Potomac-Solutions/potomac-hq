// Booking calls: the hours, the open times, and booking, cancelling and
// moving a call. Every change checks who may make it and writes an activity
// event. A client books for their own organization; someone from the public
// booking page holds a private link instead of an account.
import { calendarFile, cancel, changeable, checkBooker, whenText, type Booking, type BookerError, type BookerInput } from "../domain/booking.ts";
import { checkRules, clockValue, DEFAULT_RULES, hoursSummary, isOpen, openSlots, parseClock, WEEKDAY_NAMES, type BookingRules, type Busy, type HoursRange, type OpenDay, type RulesError, type Weekday } from "../domain/hours.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { BookingSettings, BookingStore, BusyCalendar, ClosedDay, ManageTokens } from "./ports.ts";

export type BookingDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly bookings: BookingStore;
  readonly busy: BusyCalendar;
  readonly tokens: ManageTokens;
  readonly timeZone: string;
  readonly formatWhen: (instant: string) => string;
};

const allowed = (deps: BookingDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

function rulesOf(deps: BookingDeps, settings: BookingSettings): BookingRules {
  const today = Temporal.Instant.from(deps.clock()).toZonedDateTimeISO(deps.timeZone).toPlainDate().toString();
  return { callMinutes: settings.callMinutes, gapMinutes: settings.gapMinutes, noticeHours: settings.noticeHours, daysAhead: settings.daysAhead, hours: settings.hours, closedDays: deps.bookings.closedDays(today).map((one) => one.day) };
}

/** The window open times are read from: now to the last day anyone can book, and a day either side. */
function windowOf(deps: BookingDeps, rules: BookingRules): { from: string; to: string } {
  const now = Temporal.Instant.from(deps.clock());
  return { from: now.subtract({ hours: 24 }).toString(), to: now.add({ hours: 24 * (rules.daysAhead + 2) }).toString() };
}

async function busyIn(deps: BookingDeps, rules: BookingRules): Promise<{ readonly others: readonly Busy[]; readonly failed: boolean }> {
  const window = windowOf(deps, rules);
  try {
    return { others: await deps.busy.busy(window.from, window.to), failed: false };
  } catch {
    return { others: [], failed: true };
  }
}

// ── Hours, for managers and admins ─────────────────────────────────────

export type SetupView = {
  readonly saved: boolean;
  readonly hostName: string;
  readonly callMinutes: number;
  readonly gapMinutes: number;
  readonly noticeHours: number;
  readonly daysAhead: number;
  readonly portalOpen: boolean;
  readonly publicOpen: boolean;
  readonly days: readonly { readonly weekday: Weekday; readonly name: string; readonly text: string; readonly ranges: readonly { readonly start: string; readonly end: string }[] }[];
  readonly closed: readonly (ClosedDay & { readonly label: string })[];
  readonly calendar: string;
};

/** Permission: `booking.manage`. */
export function bookingSetup(deps: BookingDeps, actorId: Id | null): Result<SetupView, "forbidden"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const settings = deps.bookings.settings();
  const hours = settings?.hours ?? [];
  const today = Temporal.Instant.from(deps.clock()).toZonedDateTimeISO(deps.timeZone).toPlainDate();
  return ok({
    saved: settings !== null,
    hostName: settings ? (deps.users.get(settings.hostId)?.name ?? "Nobody") : (deps.users.get(actorId)?.name ?? ""),
    callMinutes: settings?.callMinutes ?? DEFAULT_RULES.callMinutes,
    gapMinutes: settings?.gapMinutes ?? DEFAULT_RULES.gapMinutes,
    noticeHours: settings?.noticeHours ?? DEFAULT_RULES.noticeHours,
    daysAhead: settings?.daysAhead ?? DEFAULT_RULES.daysAhead,
    portalOpen: settings?.portalOpen ?? false,
    publicOpen: settings?.publicOpen ?? false,
    days: hoursSummary(hours).map((line) => ({
      ...line,
      ranges: [0, 1].map((n) => {
        const range = hours.filter((one) => one.weekday === line.weekday).toSorted((a, b) => a.start - b.start)[n];
        return range ? { start: clockValue(range.start), end: clockValue(range.end) } : { start: "", end: "" };
      }),
    })),
    closed: deps.bookings.closedDays(today.toString()).map((one) => ({ ...one, label: Temporal.PlainDate.from(one.day).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) })),
    calendar: deps.busy.name,
  });
}

export type SetupError = RulesError | "time-invalid" | "number-invalid";

/**
 * Saves the hours from the form: for each weekday, up to two stretches as
 * `start-<day>-<n>` and `end-<day>-<n>` ("09:00"). The one saving becomes the
 * host: calls go on their calendar.
 */
export function saveBookingSetup(deps: BookingDeps, actorId: Id | null, form: Readonly<Record<string, string>>): Result<true, "forbidden" | SetupError> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const hours: HoursRange[] = [];
  for (let day = 1 as Weekday; day <= 7; day = (day + 1) as Weekday) {
    for (const n of [0, 1]) {
      const start = (form[`start-${day}-${n}`] ?? "").trim();
      const end = (form[`end-${day}-${n}`] ?? "").trim();
      if (!start && !end) continue;
      const from = parseClock(start);
      const to = parseClock(end);
      if (from === null || to === null) return err("time-invalid");
      hours.push({ weekday: day, start: from, end: to });
    }
  }
  const number = (key: string) => (/^\d{1,3}$/.test((form[key] ?? "").trim()) ? Number(form[key]) : Number.NaN);
  const numbers = { callMinutes: number("call-minutes"), gapMinutes: number("gap-minutes"), noticeHours: number("notice-hours"), daysAhead: number("days-ahead") };
  if (Object.values(numbers).some(Number.isNaN)) return err("number-invalid");
  const checked = checkRules({ ...numbers, hours, closedDays: [] });
  if (!checked.ok) return checked;
  return deps.transact(() => {
    deps.bookings.saveSettings({ hostId: actorId, ...numbers, hours, portalOpen: form["portal-open"] === "1", publicOpen: form["public-open"] === "1" }, deps.clock());
    recordActivity(deps, { actorId, action: "booking.hours-changed", recordType: "booking-setting", recordId: deps.newId(), context: { portalOpen: form["portal-open"] === "1", publicOpen: form["public-open"] === "1" } });
    return ok(true as const);
  });
}

export function closeBookingDay(deps: BookingDeps, actorId: Id | null, day: string, note: string): Result<true, "forbidden" | "day-invalid" | "note-too-long"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  let date: Temporal.PlainDate;
  try {
    date = Temporal.PlainDate.from(day.trim(), { overflow: "reject" });
  } catch {
    return err("day-invalid");
  }
  if (note.trim().length > 100) return err("note-too-long");
  return deps.transact(() => {
    deps.bookings.closeDay({ day: date.toString(), note: note.trim() });
    recordActivity(deps, { actorId, action: "booking.day-closed", recordType: "booking-setting", recordId: deps.newId(), context: { day: date.toString() } });
    return ok(true as const);
  });
}

export function reopenBookingDay(deps: BookingDeps, actorId: Id | null, day: string): Result<true, "forbidden" | "not-found"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.bookings.openDay(day)) return err("not-found");
    recordActivity(deps, { actorId, action: "booking.day-opened", recordType: "booking-setting", recordId: deps.newId(), context: { day } });
    return ok(true as const);
  });
}

// ── Open times ──────────────────────────────────────────────────────────

export type OpenTimesView = {
  /** False when booking is off for this audience, or no hours are set. */
  readonly open: boolean;
  readonly callMinutes: number;
  readonly days: readonly (OpenDay & { readonly label: string })[];
  /** The other calendar could not be read: no times are offered rather than wrong ones. */
  readonly calendarFailed: boolean;
};

/** Whether booking is on for this audience, with hours set: a quick check, without reading any calendar. */
export function bookingOpen(deps: BookingDeps, audience: "portal" | "public"): boolean {
  const settings = deps.bookings.settings();
  return settings !== null && settings.hours.length > 0 && (audience === "portal" ? settings.portalOpen : settings.publicOpen);
}

/** The open times for clients in the portal, or for the public booking page. */
export async function openTimes(deps: BookingDeps, audience: "portal" | "public"): Promise<OpenTimesView> {
  const settings = deps.bookings.settings();
  const closed = { open: false, callMinutes: 0, days: [], calendarFailed: false };
  if (!settings || !(audience === "portal" ? settings.portalOpen : settings.publicOpen) || settings.hours.length === 0) return closed;
  const rules = rulesOf(deps, settings);
  const { others, failed } = await busyIn(deps, rules);
  if (failed) return { ...closed, open: true, callMinutes: settings.callMinutes, calendarFailed: true };
  const window = windowOf(deps, rules);
  const taken = [...deps.bookings.booked(window.from, window.to), ...others];
  const days = openSlots(rules, taken, deps.clock(), deps.timeZone).map((day) => ({ ...day, label: Temporal.PlainDate.from(day.day).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" }) }));
  return { open: true, callMinutes: settings.callMinutes, days, calendarFailed: false };
}

// ── Booking ─────────────────────────────────────────────────────────────

export type Booker =
  | { readonly kind: "client"; readonly organizationId: Id; readonly clientUserId: Id; readonly name: string; readonly email: string; readonly phone?: string | null; readonly topic?: string | null }
  | ({ readonly kind: "public" } & BookerInput);

export type BookError = BookerError | "closed" | "taken" | "calendar-failed";

/**
 * Books a call at `start`, which must still be open: checked again against
 * the other calendar and, inside the transaction, against HQ's own calls, so
 * two people cannot take the same time. A booking from the public page
 * answers its private link's token, once.
 */
export async function bookCall(deps: BookingDeps, booker: Booker, start: string): Promise<Result<{ readonly booking: Booking; readonly manageToken: string | null }, BookError>> {
  const settings = deps.bookings.settings();
  if (!settings || !(booker.kind === "client" ? settings.portalOpen : settings.publicOpen)) return err("closed");
  const who = checkBooker(booker);
  if (!who.ok) return who;
  const rules = rulesOf(deps, settings);
  const { others, failed } = await busyIn(deps, rules);
  if (failed) return err("calendar-failed");
  return deps.transact(() => {
    const window = windowOf(deps, rules);
    const slot = isOpen(rules, [...deps.bookings.booked(window.from, window.to), ...others], deps.clock(), deps.timeZone, start);
    if (!slot) return err("taken");
    const booking: Booking = {
      id: deps.newId(),
      kind: booker.kind,
      status: "booked",
      start: Temporal.Instant.from(start).toString(),
      end: slot.end,
      ...who.value,
      organizationId: booker.kind === "client" ? booker.organizationId : null,
      clientUserId: booker.kind === "client" ? booker.clientUserId : null,
      hostId: settings.hostId,
      createdAt: deps.clock(),
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: "",
    };
    const token = booker.kind === "public" ? deps.tokens.newToken() : null;
    deps.bookings.add(booking, token ? deps.tokens.hash(token) : null);
    recordActivity(deps, {
      actorId: null,
      action: "booking.made",
      recordType: "booking",
      recordId: booking.id,
      context: { kind: booking.kind, start: booking.start, ...(booking.organizationId ? { organizationId: booking.organizationId } : {}) },
    });
    return ok({ booking, manageToken: token });
  });
}

/** Who is changing a call: someone in HQ, a client for their organization, or the holder of the private link. */
export type Changer = { readonly kind: "staff"; readonly actorId: Id | null } | { readonly kind: "client"; readonly organizationId: Id } | { readonly kind: "link"; readonly token: string };

type ChangeError = "forbidden" | "not-found" | "not-changeable";

function bookingFor(deps: BookingDeps, changer: Changer, id: Id | null): Result<Booking, "forbidden" | "not-found"> {
  if (changer.kind === "staff") {
    if (!allowed(deps, changer.actorId, "call.respond")) return err("forbidden");
    const found = id ? deps.bookings.get(id) : null;
    return found ? ok(found) : err("not-found");
  }
  if (changer.kind === "client") {
    const found = id ? deps.bookings.get(id) : null;
    // Another organization's call is "not found", not "forbidden": it is not theirs to know about.
    return found && found.organizationId === changer.organizationId ? ok(found) : err("not-found");
  }
  const found = deps.bookings.byManageHash(deps.tokens.hash(changer.token));
  return found ? ok(found) : err("not-found");
}

/** A call reached by its private link, for its page. */
export function bookingByLink(deps: BookingDeps, token: string): Booking | null {
  return token ? deps.bookings.byManageHash(deps.tokens.hash(token)) : null;
}

export function cancelCall(deps: BookingDeps, changer: Changer, id: Id | null, reason: string): Result<Booking, ChangeError | "reason-too-long"> {
  return deps.transact(() => {
    const found = bookingFor(deps, changer, id);
    if (!found.ok) return found;
    const done = cancel(found.value, changer.kind === "staff" ? "staff" : "booker", reason, deps.clock());
    if (!done.ok) return err(done.error === "reason-too-long" ? "reason-too-long" : "not-changeable");
    deps.bookings.save(done.value);
    recordActivity(deps, {
      actorId: changer.kind === "staff" ? changer.actorId : null,
      action: "booking.cancelled",
      recordType: "booking",
      recordId: done.value.id,
      context: { by: done.value.cancelledBy ?? "booker", start: done.value.start, ...(done.value.organizationId ? { organizationId: done.value.organizationId } : {}) },
    });
    return ok(done.value);
  });
}

/** Moves a call to another open time. Its own time does not count as taken. */
export async function moveCall(deps: BookingDeps, changer: Changer, id: Id | null, start: string): Promise<Result<{ readonly booking: Booking; readonly was: string }, ChangeError | "taken" | "closed" | "calendar-failed">> {
  const settings = deps.bookings.settings();
  if (!settings) return err("closed");
  const rules = rulesOf(deps, settings);
  const { others, failed } = await busyIn(deps, rules);
  if (failed) return err("calendar-failed");
  return deps.transact(() => {
    const found = bookingFor(deps, changer, id);
    if (!found.ok) return found;
    if (!changeable(found.value, deps.clock())) return err("not-changeable");
    const window = windowOf(deps, rules);
    const taken = deps.bookings.booked(window.from, window.to).filter((one) => one.id !== found.value.id);
    const slot = isOpen(rules, [...taken, ...others], deps.clock(), deps.timeZone, start);
    if (!slot) return err("taken");
    const moved = { ...found.value, start: Temporal.Instant.from(start).toString(), end: slot.end };
    deps.bookings.save(moved);
    recordActivity(deps, {
      actorId: changer.kind === "staff" ? changer.actorId : null,
      action: "booking.moved",
      recordType: "booking",
      recordId: moved.id,
      context: { from: found.value.start, to: moved.start, ...(moved.organizationId ? { organizationId: moved.organizationId } : {}) },
    });
    return ok({ booking: moved, was: found.value.start });
  });
}

export type { Booking } from "../domain/booking.ts";

// ── Views ───────────────────────────────────────────────────────────────

export type CallLine = {
  readonly id: Id;
  readonly when: string;
  readonly whenIso: string;
  readonly who: string;
  readonly kindLabel: string;
  readonly email: string;
  readonly phone: string;
  readonly topic: string;
  readonly organizationId: Id | null;
  readonly cancelled: boolean;
  readonly cancelText: string;
  readonly changeable: boolean;
};

const lineOf = (deps: BookingDeps, booking: Booking): CallLine => ({
  id: booking.id,
  when: whenText(booking.start, booking.end, deps.timeZone),
  whenIso: booking.start,
  who: booking.name,
  kindLabel: booking.kind === "client" ? "Client" : "Booking page",
  email: booking.email,
  phone: booking.phone,
  topic: booking.topic,
  organizationId: booking.organizationId,
  cancelled: booking.status === "cancelled",
  cancelText: booking.status !== "cancelled" ? "" : `Cancelled by ${booking.cancelledBy === "staff" ? "Potomac" : booking.name}${booking.cancelReason ? `: ${booking.cancelReason}` : ""}`,
  changeable: changeable(booking, deps.clock()),
});

export type CallsView = {
  readonly upcoming: readonly CallLine[];
  readonly past: readonly CallLine[];
  readonly canManage: boolean;
  readonly setUp: boolean;
  readonly portalOpen: boolean;
  readonly publicOpen: boolean;
};

/** Booked calls from now, and the last two weeks. Permission: `call.respond`. */
export function callsView(deps: BookingDeps, actorId: Id | null): Result<CallsView, "forbidden"> {
  if (!allowed(deps, actorId, "call.respond")) return err("forbidden");
  const now = Temporal.Instant.from(deps.clock());
  const settings = deps.bookings.settings();
  const all = deps.bookings.between(now.subtract({ hours: 24 * 14 }).toString(), now.add({ hours: 24 * 120 }).toString());
  const started = (one: Booking) => Temporal.Instant.compare(one.start, now) <= 0;
  return ok({
    upcoming: all.filter((one) => !started(one)).map((one) => lineOf(deps, one)),
    past: all.filter(started).toReversed().map((one) => lineOf(deps, one)),
    canManage: allowed(deps, actorId, "booking.manage"),
    setUp: settings !== null && settings.hours.length > 0,
    portalOpen: settings?.portalOpen ?? false,
    publicOpen: settings?.publicOpen ?? false,
  });
}

/** The next booked calls, for the dashboard. Null without `call.respond`. */
export function nextCalls(deps: BookingDeps, actorId: Id | null, most = 5): readonly CallLine[] | null {
  if (!allowed(deps, actorId, "call.respond")) return null;
  const now = Temporal.Instant.from(deps.clock());
  return deps.bookings
    .between(now.toString(), now.add({ hours: 24 * 14 }).toString())
    .filter((one) => one.status === "booked")
    .slice(0, most)
    .map((one) => lineOf(deps, one));
}

/** A client's own calls, from now. */
export function callsForClient(deps: BookingDeps, organizationId: Id): readonly CallLine[] {
  return deps.bookings.forOrganization(organizationId, deps.clock()).map((one) => lineOf(deps, one));
}

/** A call's line for the page its private link opens. */
export const callLine = (deps: BookingDeps, booking: Booking): CallLine => lineOf(deps, booking);

/** The calendar file for a call, for the host, the client or the link's holder. */
export function calendarFor(deps: BookingDeps, booking: Booking): string {
  const host = deps.users.get(booking.hostId);
  return calendarFile(booking, {
    title: booking.kind === "client" ? "Call with Potomac Solutions" : `Call with Potomac Solutions: ${booking.name}`,
    description: booking.topic || "A call with Potomac Solutions.",
    organizer: host?.email ?? "hello@potomac.solutions",
    stamp: deps.clock(),
  });
}

export const WEEKDAYS = Object.entries(WEEKDAY_NAMES).map(([weekday, name]) => ({ weekday: Number(weekday) as Weekday, name }));

// Booking calls: the hours, the open times, and booking, cancelling and
// moving a call. Every change checks who may make it and writes an activity
// event. A client books for their own organization; someone from the public
// booking page holds a private link instead of an account.
import { calendarFile, cancel, changeable, checkBooker, whenText, type Booking, type BookerError, type BookerInput } from "../domain/booking.ts";
import { cellLabel, cellsFromRanges, gridRows, paintedIn, rangesFromCells, rangesOn, sameCells } from "../domain/grid.ts";
import { checkRules, clockLabel, clockValue, DEFAULT_RULES, hoursSummary, isOpen, openSlots, parseClock, WEEKDAY_NAMES, type BookingRules, type Busy, type HoursRange, type OpenDay, type RulesError, type Weekday } from "../domain/hours.ts";
import { addContact, createClient, createOpportunity, moveOpportunity, SERVICE_OPTIONS, type CrmDeps } from "../../crm/index.ts";
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
  return { callMinutes: settings.callMinutes, gapMinutes: settings.gapMinutes, noticeHours: settings.noticeHours, daysAhead: settings.daysAhead, hours: settings.hours, closedDays: deps.bookings.closedDays(today).map((one) => one.day), dates: deps.bookings.paintedDates(today) };
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
  // The availability grid saves the hours now; a settings form without them keeps the saved ones.
  const typed = Object.keys(form).some((key) => key.startsWith("start-") || key.startsWith("end-"));
  if (!typed) hours.push(...(deps.bookings.settings()?.hours ?? []));
  for (let day = 1 as Weekday; typed && day <= 7; day = (day + 1) as Weekday) {
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
/**
 * Whether someone signed in to the portal can book: clients when portal
 * booking is on, and anyone when sign-up to book is on, since that is how a
 * new person books once they have an account.
 */
const portalBooking = (settings: BookingSettings): boolean => settings.portalOpen || settings.publicOpen;

export function bookingOpen(deps: BookingDeps, audience: "portal" | "public"): boolean {
  const settings = deps.bookings.settings();
  return settings !== null && settings.hours.length > 0 && (audience === "portal" ? portalBooking(settings) : settings.publicOpen);
}

/** The open times for clients in the portal, or for the public booking page. */
export async function openTimes(deps: BookingDeps, audience: "portal" | "public"): Promise<OpenTimesView> {
  const settings = deps.bookings.settings();
  const closed = { open: false, callMinutes: 0, days: [], calendarFailed: false };
  if (!settings || !(audience === "portal" ? portalBooking(settings) : settings.publicOpen) || settings.hours.length === 0) return closed;
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
  if (!settings || !(booker.kind === "client" ? portalBooking(settings) : settings.publicOpen)) return err("closed");
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

// ── Into the CRM ────────────────────────────────────────────────────────

export type ToCrmError = "forbidden" | "not-found" | "already-added" | "not-public" | "business-missing" | "business-too-long" | "crm-refused";

/**
 * Makes a prospect of someone who booked from the public page: a client
 * named for their business, them as its contact, and an opportunity at
 * "consult booked" from the website, with what they wrote as its summary.
 * The call remembers it, and links to it. Permissions: the CRM's own, for
 * each record it makes.
 */
export function addBookingToCrm(deps: BookingDeps, crm: CrmDeps, actorId: Id | null, id: Id | null, input: { readonly business: string; readonly service?: string | null }): Result<{ readonly clientId: Id; readonly opportunityId: Id }, ToCrmError> {
  if (!allowed(deps, actorId, "client.create") || !allowed(deps, actorId, "opportunity.create")) return err("forbidden");
  const booking = id ? deps.bookings.get(id) : null;
  if (!booking) return err("not-found");
  if (booking.kind !== "public") return err("not-public");
  if (booking.crmClientId) return err("already-added");
  const business = input.business.trim().replace(/\s+/g, " ");
  if (!business) return err("business-missing");
  if (business.length > 120) return err("business-too-long");
  // Each step is the CRM's own service, with its own checks and activity.
  const client = createClient(crm, actorId, { name: business, sizeTier: "small" });
  if (!client.ok) return err("crm-refused");
  const contact = addContact(crm, actorId, client.value.id, { name: booking.name, email: booking.email, phone: booking.phone || null, isPrimary: true });
  const title = booking.topic ? `First call: ${booking.topic.split(/[.\n]/)[0]?.slice(0, 80) ?? ""}`.trim() : `First call with ${booking.name}`;
  const opportunity = createOpportunity(crm, actorId, client.value.id, { title, leadSource: "website", service: input.service || null, contactId: contact.ok ? contact.value.id : null, summary: booking.topic || null });
  if (!opportunity.ok) return err("crm-refused");
  moveOpportunity(crm, actorId, opportunity.value.id, { to: "consult-booked" });
  return deps.transact(() => {
    deps.bookings.setCrm(booking.id, client.value.id, opportunity.value.id);
    recordActivity(deps, { actorId, action: "booking.added-to-crm", recordType: "booking", recordId: booking.id, context: { clientId: client.value.id, opportunityId: opportunity.value.id } });
    return ok({ clientId: client.value.id, opportunityId: opportunity.value.id });
  });
}

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
  /** From the public page and not in the CRM yet: it can be added. */
  readonly canAddToCrm: boolean;
  /** Its opportunity, once added. */
  readonly crmHref: string;
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
  canAddToCrm: booking.kind === "public" && !booking.crmClientId,
  crmHref: booking.crmOpportunityId ? `/opportunities/${booking.crmOpportunityId}` : "",
});

export type CallsView = {
  readonly upcoming: readonly CallLine[];
  readonly past: readonly CallLine[];
  readonly canManage: boolean;
  /** May add someone who booked from the public page to the CRM. */
  readonly canAddToCrm: boolean;
  readonly services: readonly { readonly value: string; readonly label: string }[];
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
    canAddToCrm: allowed(deps, actorId, "client.create") && allowed(deps, actorId, "opportunity.create"),
    services: SERVICE_OPTIONS,
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

// ── The availability grid ──────────────────────────────────────────────

export type GridCell = { readonly name: string; readonly label: string; readonly className: string; readonly on: boolean; readonly disabled: boolean; readonly col: number; readonly row: number };
export type GridColumn = { readonly key: string; readonly name: string; readonly short: string; readonly sub: string; readonly painted: boolean; readonly closed: boolean; readonly past: boolean };
export type GridView = {
  readonly columns: readonly GridColumn[];
  /** Row by row, a cell for each column. */
  readonly rows: readonly { readonly at: number; readonly label: string; readonly hour: boolean; readonly cells: readonly GridCell[] }[];
};

type CellFacts = { readonly on: boolean; readonly busy: boolean; readonly booked: boolean };

/** Lays the grid out row by row for the page. */
function layGrid(rowStarts: readonly number[], columns: readonly GridColumn[], factsOf: (column: GridColumn, at: number) => CellFacts): GridView {
  return {
    columns,
    rows: rowStarts.map((at, row) => ({
      at,
      label: clockLabel(at).replace(":00 ", " "),
      hour: at % 60 === 0,
      cells: columns.map((column, col) => {
        const facts = factsOf(column, at);
        const note = facts.booked ? ", a call is booked" : facts.busy ? ", busy in your calendar" : "";
        return { name: `c-${column.key}-${at}`, label: `${column.name}, ${cellLabel(at)}${note}`, className: ["cell", facts.busy ? "busy" : "", facts.booked ? "booked" : ""].filter(Boolean).join(" "), on: facts.on, disabled: column.past, col, row };
      }),
    })),
  };
}

const GRID_DAYS = [1, 2, 3, 4, 5, 6, 7] as const satisfies readonly Weekday[];
const SHORT: Readonly<Record<Weekday, string>> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };


/** The usual week, painted. Permission: `booking.manage`. */
export function weeklyGrid(deps: BookingDeps, actorId: Id | null): Result<GridView, "forbidden"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const hours = deps.bookings.settings()?.hours ?? [];
  const on = new Map(GRID_DAYS.map((weekday) => [String(weekday), cellsFromRanges(rangesOn(hours, weekday))]));
  const columns = GRID_DAYS.map((weekday) => ({ key: String(weekday), name: `${WEEKDAY_NAMES[weekday]}s`, short: SHORT[weekday], sub: "", painted: false, closed: false, past: false }));
  return ok(layGrid(gridRows(hours), columns, (column, at) => ({ on: on.get(column.key)?.has(at) ?? false, busy: false, booked: false })));
}

/** Saves the usual week from the grid. Whoever saves it first becomes the host. Permission: `booking.manage`. */
export function saveWeeklyGrid(deps: BookingDeps, actorId: Id | null, form: Readonly<Record<string, string>>): Result<true, "forbidden" | RulesError> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const hours: HoursRange[] = GRID_DAYS.flatMap((weekday) => rangesFromCells(paintedIn(form, String(weekday))).map((range) => ({ weekday, ...range })));
  const current = deps.bookings.settings();
  const checked = checkRules({ ...DEFAULT_RULES, ...(current ?? {}), hours, closedDays: [] });
  if (!checked.ok) return checked;
  return deps.transact(() => {
    if (current) deps.bookings.saveWeek(hours, deps.clock());
    else deps.bookings.saveSettings({ hostId: actorId, callMinutes: DEFAULT_RULES.callMinutes, gapMinutes: DEFAULT_RULES.gapMinutes, noticeHours: DEFAULT_RULES.noticeHours, daysAhead: DEFAULT_RULES.daysAhead, hours, portalOpen: false, publicOpen: false }, deps.clock());
    recordActivity(deps, { actorId, action: "booking.hours-changed", recordType: "booking-setting", recordId: deps.newId(), context: { stretches: hours.length } });
    return ok(true as const);
  });
}

export type WeekGridView = GridView & {
  readonly week: string;
  readonly label: string;
  readonly previous: string;
  readonly next: string;
  readonly thisWeek: string;
  /** The calendar's busy times couldn't be read. */
  readonly calendarFailed: boolean;
  readonly calendar: string;
};

/** The Monday of the week a day is in. */
const mondayOf = (day: Temporal.PlainDate) => day.subtract({ days: day.dayOfWeek - 1 });

/**
 * One week of dates, painted: each day's own stretches if it was painted
 * differently, otherwise its weekday's. Busy times from the calendar and
 * calls already booked show underneath. Permission: `booking.manage`.
 */
export async function weekGrid(deps: BookingDeps, actorId: Id | null, wanted?: string | null): Promise<Result<WeekGridView, "forbidden">> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const today = Temporal.Instant.from(deps.clock()).toZonedDateTimeISO(deps.timeZone).toPlainDate();
  let start = mondayOf(today);
  try {
    if (wanted) start = mondayOf(Temporal.PlainDate.from(wanted, { overflow: "reject" }));
  } catch {
    // An address that isn't a date shows this week.
  }
  const days = GRID_DAYS.map((n) => start.add({ days: n - 1 }));
  const hours = deps.bookings.settings()?.hours ?? [];
  const painted = deps.bookings.paintedDates(start.toString());
  const closed = new Set(deps.bookings.closedDays(start.toString()).map((one) => one.day));
  const from = start.toZonedDateTime(deps.timeZone).toInstant();
  const to = start.add({ days: 7 }).toZonedDateTime(deps.timeZone).toInstant();
  let busy: readonly Busy[] = [];
  let failed = false;
  try {
    busy = await deps.busy.busy(from.toString(), to.toString());
  } catch {
    failed = true;
  }
  const booked = deps.bookings.booked(from.toString(), to.toString());
  const rangesFor = (day: Temporal.PlainDate) => painted[day.toString()] ?? rangesOn(hours, day.dayOfWeek as Weekday);
  const rowStarts = gridRows([...hours, ...days.flatMap((day) => rangesFor(day))]);
  const overlaps = (list: readonly { start: string; end: string }[], day: Temporal.PlainDate, at: number) => {
    const cellStart = day.toPlainDateTime({ hour: Math.floor(at / 60), minute: at % 60 }).toZonedDateTime(deps.timeZone).toInstant().epochMilliseconds;
    const cellEnd = cellStart + 30 * 60_000;
    return list.some((one) => Temporal.Instant.from(one.start).epochMilliseconds < cellEnd && Temporal.Instant.from(one.end).epochMilliseconds > cellStart);
  };
  return ok({
    week: start.toString(),
    label: `Week of ${start.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    previous: start.subtract({ days: 7 }).toString(),
    next: start.add({ days: 7 }).toString(),
    thisWeek: mondayOf(today).toString(),
    calendarFailed: failed,
    calendar: deps.busy.name,
    ...layGrid(
      rowStarts,
      days.map((day) => ({
        key: day.toString(),
        name: day.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" }),
        short: SHORT[day.dayOfWeek as Weekday],
        sub: day.toLocaleString("en-US", { month: "short", day: "numeric" }),
        painted: painted[day.toString()] !== undefined,
        closed: closed.has(day.toString()),
        past: Temporal.PlainDate.compare(day, today) < 0,
      })),
      (column, at) => {
        const day = Temporal.PlainDate.from(column.key);
        return { on: cellsFromRanges(rangesFor(day)).has(at), busy: overlaps(busy, day, at), booked: overlaps(booked, day, at) };
      },
    ),
  });
}

/**
 * Saves one week's dates from the grid. A day painted the same as its
 * weekday goes back to the usual week; a past day is left as it was.
 * Permission: `booking.manage`.
 */
export function saveWeekGrid(deps: BookingDeps, actorId: Id | null, week: string, form: Readonly<Record<string, string>>): Result<{ readonly changed: number }, "forbidden" | "day-invalid" | "no-hours-yet"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  let start: Temporal.PlainDate;
  try {
    start = mondayOf(Temporal.PlainDate.from(week, { overflow: "reject" }));
  } catch {
    return err("day-invalid");
  }
  const settings = deps.bookings.settings();
  if (!settings) return err("no-hours-yet");
  const today = Temporal.Instant.from(deps.clock()).toZonedDateTimeISO(deps.timeZone).toPlainDate();
  const before = deps.bookings.paintedDates(start.toString());
  return deps.transact(() => {
    let changed = 0;
    for (const n of GRID_DAYS) {
      const day = start.add({ days: n - 1 });
      if (Temporal.PlainDate.compare(day, today) < 0) continue;
      const ranges = rangesFromCells(paintedIn(form, day.toString()));
      const usual = rangesOn(settings.hours, day.dayOfWeek as Weekday);
      const next = sameCells(ranges, usual) ? null : ranges;
      const was = before[day.toString()] ?? null;
      if (next === null && was === null) continue;
      if (next !== null && was !== null && sameCells(next, was)) continue;
      deps.bookings.paintDate(day.toString(), next, deps.clock());
      changed += 1;
    }
    if (changed > 0) recordActivity(deps, { actorId, action: "booking.dates-painted", recordType: "booking-setting", recordId: deps.newId(), context: { week: start.toString(), days: changed } });
    return ok({ changed });
  });
}

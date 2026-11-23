// Filling in availability from somewhere else, so nobody paints a grid they
// have already filled in elsewhere.
//
// - Potomac links calendars by their private address (Google, Outlook,
//   Apple): their busy times are never offered for calls. The address is
//   kept, and read every few minutes.
// - Potomac can paint the next two weeks from a Timeful event or from
//   Calendly, once. Nothing about the source is kept.
// - Someone answering an invite can fill it in from their calendar's
//   address, a Timeful event or Calendly, once. Nothing about the source is
//   kept: only the half hours it marked, which they can then change.
//
// A calendar's address and a Calendly token are secrets. Neither is ever
// written to the activity log or shown again.
import { busyFromCalendar, joinUp } from "../domain/ical.ts";
import { CELL_MINUTES, rangesFromCells, rangesOn, sameCells } from "../domain/grid.ts";
import type { Weekday } from "../domain/hours.ts";
import type { ScheduleInvite } from "../domain/invite.ts";
import { calendarAddress, calendarSite, calendlySlots, calendlyTypes, calendlyUser, insideFree, readTimefulEvent, timefulEventId, timefulFree, timefulMarks, timefulPerson, touchesBusy, type Stretch } from "../domain/sources.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { BookingDeps } from "./booking.ts";
import { cellStart, hostFree, theirs, type Guest, type InviteDeps } from "./invites.ts";
import type { CalendarLinkStore, OutsideFetch } from "./ports.ts";

export type SourceDeps = InviteDeps & {
  readonly links: CalendarLinkStore;
  readonly outside: OutsideFetch;
  /** Reading from outside is limited for each person: ten times an hour. */
  readonly allowImport: (key: string) => boolean;
};

export type Source = { readonly kind: "calendar"; readonly link: string } | { readonly kind: "timeful"; readonly link: string; readonly name: string } | { readonly kind: "calendly"; readonly token: string };

/** A source from a form's fields: `source` says which, with `link`, `name` or `token`. */
export function sourceFrom(form: Readonly<Record<string, string>>): Source | null {
  const kind = form["source"];
  if (kind === "calendar") return { kind, link: form["link"] ?? "" };
  if (kind === "timeful") return { kind, link: form["link"] ?? "", name: form["name"] ?? "" };
  if (kind === "calendly") return { kind, token: form["token"] ?? "" };
  return null;
}

export const MAX_CALENDAR_LINKS = 5;
const HALF_HOUR_MS = CELL_MINUTES * 60_000;
const DAY_MS = 24 * 3600_000;
const allowed = (deps: BookingDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;
const iso = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toString();
const stretchOf = (one: { readonly start: string; readonly end: string }): Stretch => [Temporal.Instant.from(one.start).epochMilliseconds, Temporal.Instant.from(one.end).epochMilliseconds];

export type SourceError =
  | "source-unknown"
  | "too-many-imports"
  | "calendar-link-invalid"
  | "calendar-private"
  | "calendar-unreachable"
  | "calendar-too-large"
  | "calendar-refused"
  | "calendar-not-a-calendar"
  | "timeful-link-invalid"
  | "timeful-unreachable"
  | "timeful-not-found"
  | "timeful-unreadable"
  | "timeful-days-only"
  | "timeful-empty"
  | "timeful-hidden"
  | `timeful-who:${string}`
  | "calendly-token-invalid"
  | "calendly-refused"
  | "calendly-unreachable"
  | "calendly-no-types";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A calendar's text from its address, checked to be a calendar. */
async function readCalendar(deps: SourceDeps, link: string): Promise<Result<{ readonly url: string; readonly text: string }, SourceError>> {
  const url = calendarAddress(link);
  if (!url) return err("calendar-link-invalid");
  const got = await deps.outside(url);
  if (!got.ok) return err(got.error === "address-private" ? "calendar-private" : got.error === "too-large" ? "calendar-too-large" : got.error === "address-invalid" ? "calendar-link-invalid" : "calendar-unreachable");
  if (got.value.status !== 200) return err("calendar-refused");
  if (busyFromCalendar(got.value.text, "2000-01-01T00:00:00Z", "2000-01-02T00:00:00Z", deps.timeZone) === null) return err("calendar-not-a-calendar");
  return ok({ url, text: got.value.text });
}

type Read =
  | { readonly kind: "busy"; readonly busy: readonly Stretch[] }
  /** `days` are the days the source speaks for (in the business's zone); null when it speaks for the whole span. */
  | { readonly kind: "free"; readonly free: readonly Stretch[]; readonly days: ReadonlySet<string> | null };

/** What a source says about the time between two instants. */
async function readSource(deps: SourceDeps, source: Source, from: number, to: number): Promise<Result<Read, SourceError>> {
  if (source.kind === "calendar") {
    const calendar = await readCalendar(deps, source.link);
    if (!calendar.ok) return calendar;
    return ok({ kind: "busy", busy: (busyFromCalendar(calendar.value.text, iso(from), iso(to), deps.timeZone) ?? []).map(stretchOf) });
  }

  if (source.kind === "timeful") {
    const id = timefulEventId(source.link);
    if (!id) return err("timeful-link-invalid");
    const page = await deps.outside(`https://timeful.app/api/events/${id}`);
    if (!page.ok) return err("timeful-unreachable");
    if (page.value.status === 404) return err("timeful-not-found");
    if (page.value.status !== 200) return err("timeful-unreachable");
    const event = readTimefulEvent(parseJson(page.value.text));
    if (!event.ok) return event;
    const person = timefulPerson(event.value, source.name);
    if (!person.ok) return err(`timeful-who:${event.value.people.slice(0, 12).map((one) => one.name).join(", ")}`);
    const answers = await deps.outside(`https://timeful.app/api/events/${event.value.id}/responses?timeMin=${encodeURIComponent(iso(event.value.from))}&timeMax=${encodeURIComponent(iso(event.value.to))}`);
    if (!answers.ok || answers.value.status !== 200) return err("timeful-unreachable");
    const marks = timefulMarks(parseJson(answers.value.text), person.value.key);
    // An event can hide everyone's answers from everyone but its owner.
    if (marks === null) return err("timeful-hidden");
    const zoned = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(deps.timeZone).toPlainDate().toString();
    return ok({ kind: "free", free: timefulFree(event.value, marks, from, to, deps.timeZone), days: event.value.weekly ? null : new Set(event.value.dates.map(zoned)) });
  }

  const token = source.token.trim();
  if (!/^[A-Za-z0-9._-]{20,4000}$/.test(token)) return err("calendly-token-invalid");
  const headers = { authorization: `Bearer ${token}` };
  const call = async (url: string): Promise<Result<unknown, SourceError>> => {
    const got = await deps.outside(url, headers);
    if (!got.ok) return err("calendly-unreachable");
    if (got.value.status === 401 || got.value.status === 403) return err("calendly-refused");
    if (got.value.status !== 200) return err("calendly-unreachable");
    return ok(parseJson(got.value.text));
  };
  const me = await call("https://api.calendly.com/users/me");
  if (!me.ok) return me;
  const user = calendlyUser(me.value);
  if (!user) return err("calendly-refused");
  const types = await call(`https://api.calendly.com/event_types?user=${encodeURIComponent(user)}&active=true&count=20`);
  if (!types.ok) return types;
  const found = calendlyTypes(types.value);
  if (found.length === 0) return err("calendly-no-types");
  // Calendly answers for times from now on, a week at a time.
  const start = Math.max(from, Temporal.Instant.from(deps.clock()).epochMilliseconds + 2 * 60_000);
  const free: Stretch[] = [];
  for (const type of found) {
    for (let at = start; at < to; at += 7 * DAY_MS) {
      const times = await call(`https://api.calendly.com/event_type_available_times?event_type=${encodeURIComponent(type.uri)}&start_time=${encodeURIComponent(iso(at))}&end_time=${encodeURIComponent(iso(Math.min(to, at + 7 * DAY_MS)))}`);
      if (!times.ok) return times;
      free.push(...calendlySlots(times.value, type.minutes));
    }
  }
  return ok({ kind: "free", free: joinUp(free), days: null });
}

// ── Potomac's linked calendars ─────────────────────────────────────────

export type CalendarLinksView = {
  readonly links: readonly { readonly id: string; readonly label: string; readonly site: string; readonly problem: string }[];
  readonly canAdd: boolean;
};

/** The linked calendars, by name and site: never the address. Permission: `booking.manage`. */
export function calendarLinks(deps: SourceDeps, actorId: Id | null): Result<CalendarLinksView, "forbidden"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const links = deps.links.list();
  return ok({ links: links.map((one) => ({ id: one.id, label: one.label, site: calendarSite(one.url), problem: one.problem })), canAdd: links.length < MAX_CALENDAR_LINKS });
}

/**
 * Links a calendar by its private address. It is read once now, so a wrong
 * address is refused rather than saved. Permission: `booking.manage`.
 */
export async function addCalendarLink(deps: SourceDeps, actorId: Id | null, input: { readonly label?: string | null; readonly link: string }): Promise<Result<{ readonly label: string }, "forbidden" | "label-too-long" | "links-too-many" | "link-known" | SourceError>> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const typed = (input.label ?? "").trim().replace(/\s+/g, " ");
  if (typed.length > 60) return err("label-too-long");
  if (deps.links.list().length >= MAX_CALENDAR_LINKS) return err("links-too-many");
  if (!deps.allowImport(`staff ${actorId}`)) return err("too-many-imports");
  const calendar = await readCalendar(deps, input.link);
  if (!calendar.ok) return calendar;
  const label = typed || calendarSite(calendar.value.url).slice(0, 60) || "Calendar";
  return deps.transact(() => {
    const now = deps.links.list();
    if (now.length >= MAX_CALENDAR_LINKS) return err("links-too-many");
    if (now.some((one) => one.url === calendar.value.url)) return err("link-known");
    const id = deps.newId();
    deps.links.add({ id, label, url: calendar.value.url, addedBy: actorId, addedAt: deps.clock(), checkedAt: deps.clock(), problem: "" });
    recordActivity(deps, { actorId, action: "booking.calendar-linked", recordType: "booking-setting", recordId: id, context: { label, site: calendarSite(calendar.value.url) } });
    return ok({ label });
  });
}

/** Stops reading a linked calendar and forgets its address. Permission: `booking.manage`. */
export function removeCalendarLink(deps: SourceDeps, actorId: Id | null, id: Id): Result<true, "forbidden" | "not-found"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.links.list().find((one) => one.id === id);
    if (!found || !deps.links.remove(id)) return err("not-found");
    recordActivity(deps, { actorId, action: "booking.calendar-unlinked", recordType: "booking-setting", recordId: id, context: { label: found.label } });
    return ok(true as const);
  });
}

// ── Painting Potomac's own days from Timeful or Calendly ───────────────

/** How many days from today a fill paints. */
export const FILL_DAYS = 14;

/**
 * Paints the next two weeks from a Timeful event or Calendly: each day the
 * source speaks for is painted with the half hours it says are free, in
 * place of the usual week. A day that comes out the same as usual goes back
 * to usual. Permission: `booking.manage`.
 */
export async function fillAvailability(deps: SourceDeps, actorId: Id | null, source: Source | null): Promise<Result<{ readonly days: number; readonly halfHours: number }, "forbidden" | "no-hours-yet" | "fill-nothing" | SourceError>> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  // A calendar says when you are busy, not when you are free: it is linked, not painted from.
  if (!source || source.kind === "calendar") return err("source-unknown");
  const settings = deps.bookings.settings();
  if (!settings) return err("no-hours-yet");
  if (!deps.allowImport(`staff ${actorId}`)) return err("too-many-imports");
  const today = Temporal.Instant.from(deps.clock()).toZonedDateTimeISO(deps.timeZone).toPlainDate();
  const days = Array.from({ length: FILL_DAYS }, (_, n) => today.add({ days: n }));
  const read = await readSource(deps, source, cellStart(deps, today, 0).epochMilliseconds, cellStart(deps, today.add({ days: FILL_DAYS }), 0).epochMilliseconds);
  if (!read.ok) return read;
  if (read.value.kind !== "free") return err("source-unknown");
  const { free, days: spoken } = read.value;
  const painted = days
    .filter((day) => spoken === null || spoken.has(day.toString()))
    .map((day) => {
      const cells: number[] = [];
      for (let at = 0; at < 24 * 60; at += CELL_MINUTES) if (insideFree(free, cellStart(deps, day, at).epochMilliseconds, HALF_HOUR_MS)) cells.push(at);
      return { day, cells };
    });
  const halfHours = painted.reduce((sum, one) => sum + one.cells.length, 0);
  // Nothing free anywhere is more likely a wrong link than two weeks off.
  if (halfHours === 0) return err("fill-nothing");
  const before = deps.bookings.paintedDates(today.toString());
  return deps.transact(() => {
    let changed = 0;
    for (const { day, cells } of painted) {
      const ranges = rangesFromCells(cells);
      const next = sameCells(ranges, rangesOn(settings.hours, day.dayOfWeek as Weekday)) ? null : ranges;
      const was = before[day.toString()] ?? null;
      if (next === null && was === null) continue;
      if (next !== null && was !== null && sameCells(next, was)) continue;
      deps.bookings.paintDate(day.toString(), next, deps.clock());
      changed += 1;
    }
    if (changed > 0) recordActivity(deps, { actorId, action: "booking.dates-painted", recordType: "booking-setting", recordId: deps.newId(), context: { week: today.toString(), days: changed, from: source.kind } });
    return ok({ days: changed, halfHours });
  });
}

// ── Filling in an invite, for the person invited ───────────────────────

/**
 * Fills in an invite from the invitee's calendar, a Timeful event or
 * Calendly: of Potomac's free half hours, the ones the source says they
 * could do. It replaces their answer, and they can change it after. If the
 * source leaves nothing, their answer is left as it was.
 */
export async function fillInvite(deps: SourceDeps, guest: Guest, id: Id, source: Source | null): Promise<Result<{ readonly invite: ScheduleInvite; readonly halfHours: number }, "not-found" | "not-open" | "calendar-failed" | "fill-nothing" | SourceError>> {
  const found = theirs(deps, guest, id);
  if (!found) return err("not-found");
  if (found.status !== "open") return err("not-open");
  if (!source) return err("source-unknown");
  if (!deps.allowImport(`client ${guest.clientUserId}`)) return err("too-many-imports");
  const host = await hostFree(deps, found);
  if (host.failed) return err("calendar-failed");
  const starts = [...host.free].map((start) => ({ start, ms: Temporal.Instant.from(start).epochMilliseconds })).sort((a, b) => a.ms - b.ms);
  if (starts.length === 0) return err("fill-nothing");
  const read = await readSource(deps, source, (starts[0] as { ms: number }).ms, (starts.at(-1) as { ms: number }).ms + HALF_HOUR_MS);
  if (!read.ok) return read;
  const said = read.value;
  const chosen = starts.filter(({ ms }) => (said.kind === "busy" ? !touchesBusy(said.busy, ms, HALF_HOUR_MS) : insideFree(said.free, ms, HALF_HOUR_MS))).map((one) => one.start);
  if (chosen.length === 0) return err("fill-nothing");
  return deps.transact(() => {
    const answered = { ...found, answeredAt: deps.clock() };
    deps.invites.setCells(found.id, chosen);
    deps.invites.update(answered, deps.clock());
    recordActivity(deps, { actorId: null, action: "schedule-invite.answered", recordType: "schedule-invite", recordId: found.id, context: { organizationId: found.organizationId, clientUserId: guest.clientUserId, halfHours: chosen.length, from: source.kind } });
    return ok({ invite: answered, halfHours: chosen.length });
  });
}

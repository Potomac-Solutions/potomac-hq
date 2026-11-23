// Filling in availability from somewhere else: a calendar's private address
// (busy times), a Timeful event (the times someone marked on it), or
// Calendly (the times its owner can be booked). This file reads what those
// send back; fetching is done by the application layer.
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { joinUp } from "./ical.ts";

export type Stretch = readonly [start: number, end: number];

/** A calendar's address as typed: https, or webcal (which is https by another name). */
export function calendarAddress(typed: string): string | null {
  const text = typed.trim().replace(/^webcals?:\/\//i, "https://");
  if (text.length < 12 || text.length > 2000) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The site a calendar's address is on, to show instead of the address itself. */
export const calendarSite = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** The event id in a Timeful link like https://timeful.app/e/fqQrJT. */
export function timefulEventId(typed: string): string | null {
  try {
    const url = new URL(typed.trim());
    const match = /^\/e\/([A-Za-z0-9_-]{3,40})\/?$/.exec(url.pathname);
    return url.protocol === "https:" && /^(www\.)?(timeful\.app|schej\.it)$/.test(url.hostname) && match ? (match[1] as string) : null;
  } catch {
    return null;
  }
}

const millis = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  try {
    return Temporal.Instant.from(value).epochMilliseconds;
  } catch {
    return null;
  }
};
const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

export type TimefulEvent = {
  readonly id: string;
  /** "specific_dates", or "dow" for a poll over days of the week. */
  readonly weekly: boolean;
  /** Minutes each marked time stands for. */
  readonly increment: number;
  readonly zone: string | null;
  /** The span its times fall in: for asking for the responses. */
  readonly from: number;
  readonly to: number;
  /** The days it asks about. */
  readonly dates: readonly number[];
  /** Who answered, by the key the responses use. */
  readonly people: readonly { readonly key: string; readonly name: string }[];
};

export type TimefulError = "timeful-unreadable" | "timeful-days-only" | "timeful-empty";

/** A Timeful event, as its page's own data describes it. */
export function readTimefulEvent(json: unknown): Result<TimefulEvent, TimefulError> {
  const event = record(json);
  const id = event && typeof event["_id"] === "string" ? event["_id"] : null;
  if (!event || !id || !/^[0-9a-f]{24}$/.test(id)) return err("timeful-unreadable");
  if (event["daysOnly"] === true) return err("timeful-days-only");
  const dates = (Array.isArray(event["dates"]) ? event["dates"] : []).map(millis).filter((one) => one !== null);
  if (dates.length === 0) return err("timeful-unreadable");
  const people: { key: string; name: string }[] = [];
  for (const [key, value] of Object.entries(record(event["responses"]) ?? {})) {
    const response = record(value);
    const user = record(response?.["user"]);
    const name = [user?.["firstName"], user?.["lastName"]].filter((part) => typeof part === "string" && part.trim()).join(" ").trim() || (typeof response?.["name"] === "string" ? response["name"].trim() : "");
    if (name) people.push({ key, name: name.slice(0, 80) });
  }
  if (people.length === 0) return err("timeful-empty");
  const increment = typeof event["timeIncrement"] === "number" && [15, 30, 60].includes(event["timeIncrement"]) ? event["timeIncrement"] : 15;
  const day = 24 * 3600_000;
  return ok({ id, weekly: event["type"] === "dow", increment, zone: typeof event["timezone"] === "string" ? event["timezone"] : null, from: Math.min(...dates) - day, to: Math.max(...dates) + 2 * day, dates, people: people.slice(0, 100) });
}

/**
 * Which person on a Timeful event is meant. With one person on it, that
 * one; otherwise the one whose name was typed, in any case.
 */
export function timefulPerson(event: TimefulEvent, typed: string): Result<{ readonly key: string; readonly name: string }, "timeful-who"> {
  const wanted = typed.trim().toLowerCase().replace(/\s+/g, " ");
  if (!wanted && event.people.length === 1) return ok(event.people[0] as { key: string; name: string });
  const exact = event.people.filter((one) => one.name.toLowerCase() === wanted);
  const close = exact.length > 0 ? exact : wanted ? event.people.filter((one) => one.name.toLowerCase().startsWith(wanted)) : [];
  return close.length === 1 ? ok(close[0] as { key: string; name: string }) : err("timeful-who");
}

/** The times one person marked on a Timeful event, as its responses data gives them. Null when the data isn't that. */
export function timefulMarks(json: unknown, key: string): number[] | null {
  const response = record(record(json)?.[key]);
  if (!response || !Array.isArray(response["availability"])) return null;
  return response["availability"].map(millis).filter((one) => one !== null).slice(0, 20_000);
}

/**
 * Marked times as stretches of free time between two instants. On a poll
 * over days of the week, each mark is a weekday and a time of day, laid
 * over every such day in the span.
 */
export function timefulFree(event: TimefulEvent, marks: readonly number[], from: number, to: number, zone: string): Stretch[] {
  const length = event.increment * 60_000;
  if (!event.weekly) return joinUp(marks.filter((at) => at < to && at + length > from).map((at) => [at, at + length] as const));
  const at = new Set<string>();
  const inZone = event.zone ?? zone;
  for (const mark of marks) {
    try {
      const local = Temporal.Instant.fromEpochMilliseconds(mark).toZonedDateTimeISO(inZone);
      at.add(`${local.dayOfWeek} ${local.hour * 60 + local.minute}`);
    } catch {
      // A zone this server doesn't know: nothing to lay out.
    }
  }
  const out: Stretch[] = [];
  let day = Temporal.Instant.fromEpochMilliseconds(from).toZonedDateTimeISO(zone).toPlainDate();
  const last = Temporal.Instant.fromEpochMilliseconds(to).toZonedDateTimeISO(zone).toPlainDate();
  for (let n = 0; n < 120 && Temporal.PlainDate.compare(day, last) <= 0; n += 1, day = day.add({ days: 1 })) {
    for (const key of at) {
      const [weekday, minutes] = key.split(" ").map(Number) as [number, number];
      if (weekday !== day.dayOfWeek) continue;
      const start = day.toPlainDateTime({ hour: Math.floor(minutes / 60), minute: minutes % 60 }).toZonedDateTime(zone).epochMilliseconds;
      if (start < to && start + length > from) out.push([start, start + length]);
    }
  }
  return joinUp(out);
}

export type CalendlyType = { readonly uri: string; readonly minutes: number };

/** The signed-in person's address in Calendly's API, from /users/me. */
export function calendlyUser(json: unknown): string | null {
  const uri = record(record(json)?.["resource"])?.["uri"];
  return typeof uri === "string" && uri.startsWith("https://api.calendly.com/users/") && uri.length < 200 ? uri : null;
}

/** Their active event types, from /event_types: at most five. */
export function calendlyTypes(json: unknown): CalendlyType[] {
  const list = record(json)?.["collection"];
  const out: CalendlyType[] = [];
  for (const one of Array.isArray(list) ? list : []) {
    const type = record(one);
    const uri = type?.["uri"];
    const minutes = type?.["duration"];
    if (type?.["active"] === false || typeof uri !== "string" || !uri.startsWith("https://api.calendly.com/event_types/") || typeof minutes !== "number" || minutes < 5 || minutes > 720) continue;
    out.push({ uri, minutes });
    if (out.length === 5) break;
  }
  return out;
}

/** The times an event type can be booked, from /event_type_available_times, each as long as the event. */
export function calendlySlots(json: unknown, minutes: number): Stretch[] {
  const list = record(json)?.["collection"];
  const out: Stretch[] = [];
  for (const one of Array.isArray(list) ? list : []) {
    const slot = record(one);
    const start = slot?.["status"] === "available" ? millis(slot["start_time"]) : null;
    if (start !== null) out.push([start, start + minutes * 60_000]);
  }
  return out;
}

/** Whether a stretch of time lies wholly inside free time (joined-up stretches). */
export const insideFree = (free: readonly Stretch[], start: number, length: number): boolean => free.some(([from, to]) => from <= start && start + length <= to);
/** Whether a stretch of time touches any busy time. */
export const touchesBusy = (busy: readonly Stretch[], start: number, length: number): boolean => busy.some(([from, to]) => start < to && start + length > from);

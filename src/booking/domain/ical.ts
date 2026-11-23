// Reads a calendar file (iCalendar, RFC 5545) for one thing: when its owner
// is busy. Google Calendar, Outlook and Apple all publish a calendar this
// way, at a private address. Nothing about an event is kept but its times:
// not its title, place or guests.
//
// Understood: timed and all-day events, time zones, durations, events marked
// free or cancelled (left out), and repeating events (daily, weekly, monthly
// and yearly, with an interval, a count or an end, chosen weekdays and month
// days, skipped dates, and single occurrences that were moved). Rarer rules
// (BYSETPOS, BYHOUR and the like) are read without that part.
import type { Busy } from "./hours.ts";

/** Outlook names time zones its own way. The common ones, as IANA names. */
const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
  UTC: "UTC",
};

const MAX_EVENTS = 5000;
const MAX_OCCURRENCES = 1500;
const DAYS: Readonly<Record<string, number>> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

type Line = { readonly name: string; readonly params: Readonly<Record<string, string>>; readonly value: string };

function parseLine(raw: string): Line | null {
  // The value starts at the first colon outside quotes.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '"') quoted = !quoted;
    else if (raw[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 1) return null;
  const [name, ...rest] = raw.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const part of rest) {
    const equals = part.indexOf("=");
    if (equals > 0) params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, "");
  }
  return { name: (name as string).toUpperCase(), params, value: raw.slice(colon + 1).trim() };
}

function zoneOf(tzid: string | undefined, fallback: string): string {
  if (!tzid) return fallback;
  const name = WINDOWS_ZONES[tzid] ?? tzid;
  try {
    Temporal.Now.instant().toZonedDateTimeISO(name);
    return name;
  } catch {
    return fallback;
  }
}

type When = { readonly local: Temporal.PlainDateTime; readonly zone: string; readonly allDay: boolean };

function parseWhen(line: Line, fallback: string): When | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(line.value);
  if (!match) return null;
  try {
    const [, y, m, d, hh, mm, ss, z] = match;
    const local = Temporal.PlainDateTime.from({ year: Number(y), month: Number(m), day: Number(d), hour: Number(hh ?? 0), minute: Number(mm ?? 0), second: Number(ss ?? 0) }, { overflow: "reject" });
    return { local, zone: z ? "UTC" : zoneOf(line.params["TZID"], fallback), allDay: hh === undefined };
  } catch {
    return null;
  }
}

const instantOf = (local: Temporal.PlainDateTime, zone: string): number => local.toZonedDateTime(zone).epochMilliseconds;

/** A duration like PT1H30M or P1D, in milliseconds. */
function parseDuration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match || match[1] === "-") return null;
  const [, , w, d, h, m, s] = match;
  return ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 24 * 3600 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000;
}

type Rule = {
  readonly freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  readonly interval: number;
  readonly count: number | null;
  readonly until: number | null;
  readonly byDay: readonly { readonly nth: number | null; readonly weekday: number }[];
  readonly byMonthDay: readonly number[];
};

function parseRule(value: string, start: When): Rule | null {
  const parts: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [key, text] = part.split("=");
    if (key && text !== undefined) parts[key.toUpperCase()] = text;
  }
  const freq = parts["FREQ"];
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const interval = Math.max(1, Math.min(1000, Number(parts["INTERVAL"] ?? 1) || 1));
  const count = parts["COUNT"] && /^\d+$/.test(parts["COUNT"]) ? Number(parts["COUNT"]) : null;
  let until: number | null = null;
  if (parts["UNTIL"]) {
    const end = parseWhen({ name: "UNTIL", params: {}, value: parts["UNTIL"] }, start.zone);
    // A date alone means through the end of that day.
    if (end) until = end.allDay ? instantOf(end.local.add({ days: 1 }), start.zone) - 1 : instantOf(end.local, end.zone);
  }
  const byDay = (parts["BYDAY"] ?? "")
    .split(",")
    .map((one) => /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(one.trim().toUpperCase()))
    .filter((one) => one !== null)
    .map((one) => ({ nth: one[1] ? Number(one[1]) : null, weekday: DAYS[one[2] as string] as number }));
  const byMonthDay = (parts["BYMONTHDAY"] ?? "")
    .split(",")
    .map((one) => Number(one))
    .filter((one) => Number.isInteger(one) && one !== 0 && Math.abs(one) <= 31);
  return { freq, interval, count, until, byDay, byMonthDay };
}

/** The dates a rule lands on in its k-th period, in order. */
function datesIn(rule: Rule, start: Temporal.PlainDate, k: number): Temporal.PlainDate[] {
  if (rule.freq === "DAILY") {
    const day = start.add({ days: k * rule.interval });
    return rule.byDay.length === 0 || rule.byDay.some((one) => one.weekday === day.dayOfWeek) ? [day] : [];
  }
  if (rule.freq === "WEEKLY") {
    const monday = start.subtract({ days: start.dayOfWeek - 1 }).add({ weeks: k * rule.interval });
    const weekdays = rule.byDay.length > 0 ? [...new Set(rule.byDay.map((one) => one.weekday))].sort((a, b) => a - b) : [start.dayOfWeek];
    return weekdays.map((weekday) => monday.add({ days: weekday - 1 }));
  }
  if (rule.freq === "YEARLY") {
    const year = start.year + k * rule.interval;
    try {
      return [Temporal.PlainDate.from({ year, month: start.month, day: start.day }, { overflow: "reject" })];
    } catch {
      return [];
    }
  }
  const first = Temporal.PlainDate.from({ year: start.year, month: start.month, day: 1 }).add({ months: k * rule.interval });
  const days = first.daysInMonth;
  const out = new Set<number>();
  if (rule.byMonthDay.length > 0) {
    for (const n of rule.byMonthDay) {
      const day = n > 0 ? n : days + 1 + n;
      if (day >= 1 && day <= days) out.add(day);
    }
  } else if (rule.byDay.length > 0) {
    for (const { nth, weekday } of rule.byDay) {
      const matching: number[] = [];
      for (let day = 1; day <= days; day += 1) if (first.add({ days: day - 1 }).dayOfWeek === weekday) matching.push(day);
      if (nth === null) for (const day of matching) out.add(day);
      else {
        const day = nth > 0 ? matching[nth - 1] : matching[matching.length + nth];
        if (day !== undefined) out.add(day);
      }
    }
  } else if (start.day <= days) {
    out.add(start.day);
  }
  return [...out].sort((a, b) => a - b).map((day) => first.add({ days: day - 1 }));
}

/** How many periods can be skipped before the window, for a rule with no count. */
function firstPeriod(rule: Rule, start: Temporal.PlainDate, from: Temporal.PlainDate): number {
  if (rule.count !== null || Temporal.PlainDate.compare(from, start) <= 0) return 0;
  const days = start.until(from, { largestUnit: "days" }).days;
  const periods = rule.freq === "DAILY" ? days / rule.interval : rule.freq === "WEEKLY" ? days / (7 * rule.interval) : rule.freq === "MONTHLY" ? days / (31 * rule.interval) : days / (366 * rule.interval);
  return Math.max(0, Math.floor(periods) - 1);
}

type Event = {
  readonly uid: string;
  readonly start: When;
  readonly length: number;
  readonly rule: Rule | null;
  readonly skipped: ReadonlySet<number>;
  /** Set when this is one occurrence of a repeating event, moved: the time it was moved from. */
  readonly movedFrom: number | null;
};

function readEvents(text: string, fallbackZone: string): Event[] | null {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  if (!lines.some((line) => line.trim().toUpperCase() === "BEGIN:VCALENDAR")) return null;
  const events: Event[] = [];
  let current: Line[] | null = null;
  let depth = 0;
  for (const raw of lines) {
    const upper = raw.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      depth = 0;
      continue;
    }
    if (current === null) continue;
    // Alarms and the like sit inside an event; their lines aren't the event's.
    if (upper.startsWith("BEGIN:")) depth += 1;
    else if (upper.startsWith("END:") && upper !== "END:VEVENT") depth = Math.max(0, depth - 1);
    else if (upper === "END:VEVENT") {
      const event = toEvent(current, fallbackZone);
      if (event) events.push(event);
      current = null;
      if (events.length >= MAX_EVENTS) break;
    } else if (depth === 0) {
      const line = parseLine(raw);
      if (line) current.push(line);
    }
  }
  return events;
}

function toEvent(lines: readonly Line[], fallbackZone: string): Event | null {
  const one = (name: string) => lines.find((line) => line.name === name);
  if (one("TRANSP")?.value.toUpperCase() === "TRANSPARENT" || one("STATUS")?.value.toUpperCase() === "CANCELLED") return null;
  const startLine = one("DTSTART");
  const start = startLine ? parseWhen(startLine, fallbackZone) : null;
  if (!start) return null;
  const endLine = one("DTEND");
  const end = endLine ? parseWhen(endLine, start.zone) : null;
  const duration = one("DURATION");
  const length = end ? instantOf(end.local, end.zone) - instantOf(start.local, start.zone) : duration ? parseDuration(duration.value) : start.allDay ? 24 * 3600 * 1000 : 0;
  if (length === null || length <= 0) return null;
  const ruleLine = one("RRULE");
  const skipped = new Set<number>();
  for (const line of lines) {
    if (line.name !== "EXDATE") continue;
    for (const value of line.value.split(",")) {
      const when = parseWhen({ ...line, value: value.trim() }, start.zone);
      if (when) skipped.add(instantOf(when.local, when.zone));
    }
  }
  const movedLine = one("RECURRENCE-ID");
  const moved = movedLine ? parseWhen(movedLine, start.zone) : null;
  return { uid: one("UID")?.value ?? "", start, length, rule: ruleLine ? parseRule(ruleLine.value, start) : null, skipped, movedFrom: moved ? instantOf(moved.local, moved.zone) : null };
}

/**
 * The busy times in a calendar file between two instants, joined up and in
 * order. Null when the text isn't a calendar. `zone` is used for times that
 * name no time zone, and for all-day events.
 */
export function busyFromCalendar(text: string, from: string, to: string, zone: string): Busy[] | null {
  const events = readEvents(text, zone);
  if (events === null) return null;
  const fromMs = Temporal.Instant.from(from).epochMilliseconds;
  const toMs = Temporal.Instant.from(to).epochMilliseconds;
  // Occurrences that were moved: the repeating event skips the time they were moved from.
  const moved = new Map<string, Set<number>>();
  for (const event of events) {
    if (event.movedFrom === null || !event.uid) continue;
    const set = moved.get(event.uid) ?? new Set<number>();
    set.add(event.movedFrom);
    moved.set(event.uid, set);
  }
  const found: [number, number][] = [];
  const keep = (start: number, length: number) => {
    if (start < toMs && start + length > fromMs) found.push([start, start + length]);
  };
  for (const event of events) {
    const first = instantOf(event.start.local, event.start.zone);
    if (!event.rule || event.movedFrom !== null) {
      keep(first, event.length);
      continue;
    }
    const rule = event.rule;
    const startDate = event.start.local.toPlainDate();
    const time = event.start.local.toPlainTime();
    const gone = moved.get(event.uid);
    const windowStart = Temporal.Instant.fromEpochMilliseconds(fromMs - event.length).toZonedDateTimeISO(event.start.zone).toPlainDate();
    let made = 0;
    let quiet = 0;
    outer: for (let k = firstPeriod(rule, startDate, windowStart); made < MAX_OCCURRENCES && quiet < 1500; k += 1) {
      const dates = datesIn(rule, startDate, k);
      quiet = dates.length === 0 ? quiet + 1 : 0;
      for (const date of dates) {
        if (Temporal.PlainDate.compare(date, startDate) < 0) continue;
        const at = instantOf(date.toPlainDateTime(time), event.start.zone);
        if (rule.until !== null && at > rule.until) break outer;
        if (at >= toMs) break outer;
        made += 1;
        if (rule.count !== null && made > rule.count) break outer;
        if (!event.skipped.has(at) && !gone?.has(at)) keep(at, event.length);
      }
    }
  }
  return joinUp(found).map(([start, end]) => ({ start: Temporal.Instant.fromEpochMilliseconds(start).toString(), end: Temporal.Instant.fromEpochMilliseconds(end).toString() }));
}

/** Stretches of time in order, with any that touch or overlap made one. */
export function joinUp(stretches: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = [...stretches].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = out.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

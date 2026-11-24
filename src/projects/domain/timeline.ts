// The timeline (decision 0007, section 9): where things sit between two
// dates, as percentages of the width, so the server can draw it with no
// script. A bar runs from its start to its end; something with only an end
// (a due date, a milestone) is a point.

/** Days either side of the dated things, so nothing sits on the edge. */
const PADDING_DAYS = 3;
/** Up to this many days, ticks mark each week (Mondays); beyond, each month. */
const WEEKLY_UP_TO = 120;

export type Scale = {
  /** The first and last day shown, YYYY-MM-DD. */
  readonly from: string;
  readonly to: string;
  readonly days: number;
  /** Where today is, or null when it's out of range. */
  readonly today: number | null;
  readonly ticks: readonly { readonly at: number; readonly label: string; readonly day: string }[];
};

export type Placement = {
  /** Percent from the left edge. */
  readonly left: number;
  /** Percent wide; 0 for a point. */
  readonly width: number;
  readonly point: boolean;
};

const day = (text: string) => Temporal.PlainDate.from(text);
const between = (a: Temporal.PlainDate, b: Temporal.PlainDate) => a.until(b, { largestUnit: "days" }).days;
const round = (value: number) => Math.round(value * 100) / 100;

/** A scale wide enough for every date given, and today. Null with no dates at all. */
export function scaleFor(dates: readonly (string | null)[], today: string): Scale | null {
  const known = dates.filter((one): one is string => one !== null).sort();
  if (known.length === 0) return null;
  const now = day(today);
  let first = day(known[0] as string);
  let last = day(known.at(-1) as string);
  // Keep today in view unless it's far off: within a quarter-year of the work.
  if (Temporal.PlainDate.compare(now, first) < 0 && between(now, first) <= 90) first = now;
  if (Temporal.PlainDate.compare(now, last) > 0 && between(last, now) <= 90) last = now;
  const from = first.subtract({ days: PADDING_DAYS });
  const to = last.add({ days: PADDING_DAYS });
  // One more day than the difference: the last day has width too.
  const days = between(from, to) + 1;
  const at = (date: Temporal.PlainDate) => round((between(from, date) / days) * 100);
  const inRange = (date: Temporal.PlainDate) => Temporal.PlainDate.compare(date, from) >= 0 && Temporal.PlainDate.compare(date, to) <= 0;
  const ticks: { at: number; label: string; day: string }[] = [];
  if (days <= WEEKLY_UP_TO) {
    for (let tick = from.add({ days: (8 - from.dayOfWeek) % 7 }); Temporal.PlainDate.compare(tick, to) <= 0; tick = tick.add({ weeks: 1 })) {
      ticks.push({ at: at(tick), label: tick.toLocaleString("en-US", { month: "short", day: "numeric" }), day: tick.toString() });
    }
  } else {
    for (let tick = from.with({ day: 1 }).add({ months: from.day === 1 ? 0 : 1 }); Temporal.PlainDate.compare(tick, to) <= 0; tick = tick.add({ months: 1 })) {
      ticks.push({ at: at(tick), label: tick.toLocaleString("en-US", { month: "short", ...(tick.month === 1 ? { year: "numeric" } : {}) }), day: tick.toString() });
    }
  }
  return { from: from.toString(), to: to.toString(), days, today: inRange(now) ? round(at(now) + 50 / days) : null, ticks };
}

/**
 * Where something sits. With a start and an end, a bar covering both days;
 * with only one of them, a point in the middle of that day. Null with neither.
 */
export function place(scale: Scale, start: string | null, end: string | null): Placement | null {
  const from = day(scale.from);
  const pct = (date: string) => (between(from, day(date)) / scale.days) * 100;
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  if (start !== null && end !== null && start < end) {
    const left = clamp(pct(start));
    return { left: round(left), width: round(clamp(pct(end) + 100 / scale.days) - left), point: false };
  }
  const only = end ?? start;
  if (only === null) return null;
  return { left: round(clamp(pct(only) + 50 / scale.days)), width: 0, point: true };
}

/** "Nov 24 to Dec 5", "Due Dec 5" or "Starts Nov 24", for words beside a bar. */
export function spanText(start: string | null, end: string | null, endWord = "Due"): string {
  const short = (date: string) => day(date).toLocaleString("en-US", { month: "short", day: "numeric" });
  if (start !== null && end !== null && start < end) return `${short(start)} to ${short(end)}`;
  if (end !== null) return `${endWord} ${short(end)}`;
  return start !== null ? `Starts ${short(start)}` : "";
}

/** The earliest start and latest end of several spans, for a phase or project drawn from its parts. */
export function spanOf(spans: readonly { readonly start: string | null; readonly end: string | null }[]): { readonly start: string | null; readonly end: string | null } {
  const dates = spans.flatMap((one) => [one.start, one.end]).filter((one): one is string => one !== null).sort();
  return dates.length === 0 ? { start: null, end: null } : { start: dates[0] as string, end: dates.at(-1) as string };
}

// Writing calendar files (RFC 5545) of all-day events, for a feed that
// calendar apps subscribe to. Text is escaped and long lines folded, as the
// standard asks.

export type AllDayEvent = {
  /** Stays the same for the same thing, so a calendar updates it rather than adding another. */
  readonly uid: string;
  readonly summary: string;
  readonly description: string;
  readonly url: string;
  /** YYYY-MM-DD, the first day. */
  readonly start: string;
  /** YYYY-MM-DD, the last day, inclusive. */
  readonly end: string;
};

const text = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const date = (day: string) => day.replace(/-/g, "");

function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (size + width > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** A whole calendar. `stamp` is a UTC instant; apps are asked to check back hourly. */
export function allDayCalendar(name: string, events: readonly AllDayEvent[], stamp: string): string {
  const utc = Temporal.Instant.from(stamp).toString({ smallestUnit: "second" }).replace(/[-:]/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Potomac Solutions//Potomac HQ//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flatMap((event) => [
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${utc}`,
      `DTSTART;VALUE=DATE:${date(event.start)}`,
      // The end of an all-day event is the day after its last.
      `DTEND;VALUE=DATE:${date(Temporal.PlainDate.from(event.end).add({ days: 1 }).toString())}`,
      `SUMMARY:${text(event.summary)}`,
      `DESCRIPTION:${text(event.description)}`,
      `URL:${event.url}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

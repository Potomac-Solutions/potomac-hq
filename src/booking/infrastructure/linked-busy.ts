// Busy times from every calendar HQ knows about: the Google Calendar set up
// on the server, if there is one, and each linked calendar's private
// address. A linked calendar is read at most every five minutes. If it
// can't be read, its last answer is used for up to an hour; after that the
// busy times are unknown, and open times are not offered rather than
// offered wrong.
import { busyFromCalendar } from "../domain/ical.ts";
import type { Busy } from "../domain/hours.ts";
import type { BusyCalendar, CalendarLink, CalendarLinkStore, OutsideFetch } from "../application/ports.ts";

const FRESH_MS = 5 * 60_000;
const STALE_MS = 60 * 60_000;

export const CALENDAR_PROBLEMS: Readonly<Record<string, string>> = {
  "address-invalid": "The address isn’t an https link.",
  "address-private": "The address isn’t on the public internet.",
  unreachable: "The calendar couldn’t be reached.",
  "too-large": "The calendar is too big to read (over 2 MB).",
  refused: "The calendar’s site refused the link. It may have been reset.",
  "not-a-calendar": "The link didn’t open a calendar.",
};

export function linkedBusyCalendar(base: BusyCalendar, links: CalendarLinkStore, outside: OutsideFetch, options: { readonly timeZone: string; readonly now?: () => number }): BusyCalendar {
  const now = options.now ?? Date.now;
  const kept = new Map<string, { readonly text: string; readonly at: number }>();

  /** The calendar's text, fresh or kept. Throws when there is neither. */
  async function textOf(link: CalendarLink): Promise<string> {
    const had = kept.get(link.url);
    if (had && now() - had.at < FRESH_MS) return had.text;
    const got = await outside(link.url);
    const problem = !got.ok ? got.error : got.value.status !== 200 ? "refused" : busyFromCalendar(got.value.text, "2000-01-01T00:00:00Z", "2000-01-02T00:00:00Z", options.timeZone) === null ? "not-a-calendar" : "";
    links.checked(link.id, new Date(now()).toISOString(), CALENDAR_PROBLEMS[problem] ?? "");
    if (got.ok && problem === "") {
      kept.set(link.url, { text: got.value.text, at: now() });
      return got.value.text;
    }
    if (had && now() - had.at < STALE_MS) return had.text;
    throw new Error(`A linked calendar could not be read: ${problem}`);
  }

  return {
    get name() {
      return base.name !== "none" ? base.name : links.list().length > 0 ? "your linked calendars" : "none";
    },
    async busy(from, to) {
      const all: Busy[] = [...(await base.busy(from, to))];
      const current = links.list();
      for (const url of kept.keys()) if (!current.some((link) => link.url === url)) kept.delete(url);
      for (const link of current) all.push(...(busyFromCalendar(await textOf(link), from, to, options.timeZone) ?? []));
      return all;
    },
  };
}

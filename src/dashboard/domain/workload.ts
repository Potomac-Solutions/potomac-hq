// Team workload (quality of life, 2026-11-25): who has what due this week,
// what's overdue, and who is working more than their usual hours, so work
// can be moved before someone is swamped.

export type WorkloadRow = {
  readonly userId: string;
  readonly name: string;
  readonly open: number;
  readonly dueThisWeek: number;
  readonly overdue: number;
  /** Minutes logged this week, Monday on. */
  readonly minutesThisWeek: number;
  /** Minutes logged in the four weeks before this one. */
  readonly minutesLastFourWeeks: number;
};

export type WorkloadLine = {
  readonly userId: string;
  readonly name: string;
  readonly open: number;
  readonly dueThisWeek: number;
  readonly overdue: number;
  readonly hours: string;
  readonly usual: string;
  /** Why to look, or empty. */
  readonly flag: string;
  readonly href: string;
};

const hours = (minutes: number): string => `${Math.round((minutes / 60) * 10) / 10} h`;

/** A busy week: more than this many due. */
export const BUSY_WEEK = 8;

/**
 * Each person's week. Hours are compared with their own usual week (the four
 * before, averaged), and only once the week is far enough along to say.
 * `weekdaysGone` is how many working days of this week have started (1 to 5).
 */
export function workloadLines(rows: readonly WorkloadRow[], weekdaysGone: number): readonly WorkloadLine[] {
  return rows
    .map((row) => {
      const usualWeek = row.minutesLastFourWeeks / 4;
      const soFar = usualWeek * (Math.min(5, Math.max(1, weekdaysGone)) / 5);
      const flags = [
        ...(row.overdue > 0 ? [`${row.overdue} overdue`] : []),
        ...(row.dueThisWeek > BUSY_WEEK ? [`${row.dueThisWeek} due this week`] : []),
        ...(usualWeek >= 60 && row.minutesThisWeek > soFar * 1.25 ? ["more hours than usual"] : []),
      ];
      return {
        userId: row.userId,
        name: row.name,
        open: row.open,
        dueThisWeek: row.dueThisWeek,
        overdue: row.overdue,
        hours: hours(row.minutesThisWeek),
        usual: usualWeek > 0 ? hours(usualWeek) : "—",
        flag: flags.join(", "),
        href: `/work?who=${row.userId}`,
      };
    })
    .sort((a, b) => Number(Boolean(b.flag)) - Number(Boolean(a.flag)) || b.dueThisWeek + b.overdue - (a.dueThisWeek + a.overdue) || a.name.localeCompare(b.name));
}

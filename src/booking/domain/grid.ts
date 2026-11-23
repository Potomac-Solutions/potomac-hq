// The availability grid: half-hour cells painted on or off, like a sheet of
// graph paper over the week. Painted cells next to each other make one
// stretch of hours; stretches become cells again to show them.
import type { DayRange, HoursRange, Weekday } from "./hours.ts";
import { clockLabel } from "./hours.ts";

/** Each cell is half an hour. */
export const CELL_MINUTES = 30;
/** The grid runs 6:00 AM to 10:00 PM unless saved hours reach further. */
const FIRST = 6 * 60;
const LAST = 22 * 60;

/** The cell starts to show, in minutes after midnight: 6:00 AM to 9:30 PM, widened to fit any saved stretch. */
export function gridRows(ranges: readonly DayRange[]): readonly number[] {
  const from = Math.min(FIRST, ...ranges.map((one) => Math.floor(one.start / CELL_MINUTES) * CELL_MINUTES));
  const to = Math.max(LAST, ...ranges.map((one) => Math.ceil(one.end / CELL_MINUTES) * CELL_MINUTES));
  const rows: number[] = [];
  for (let at = from; at < to; at += CELL_MINUTES) rows.push(at);
  return rows;
}

/** Painted cell starts → stretches, joining cells next to each other. */
export function rangesFromCells(starts: Iterable<number>): DayRange[] {
  const sorted = [...new Set(starts)].filter((at) => Number.isInteger(at) && at >= 0 && at + CELL_MINUTES <= 24 * 60 && at % CELL_MINUTES === 0).toSorted((a, b) => a - b);
  const ranges: { start: number; end: number }[] = [];
  for (const at of sorted) {
    const last = ranges.at(-1);
    if (last && last.end === at) last.end = at + CELL_MINUTES;
    else ranges.push({ start: at, end: at + CELL_MINUTES });
  }
  return ranges;
}

/** Stretches → the cells they cover. A cell counts when its whole half hour is inside. */
export function cellsFromRanges(ranges: readonly DayRange[]): ReadonlySet<number> {
  const cells = new Set<number>();
  for (const range of ranges) {
    for (let at = Math.ceil(range.start / CELL_MINUTES) * CELL_MINUTES; at + CELL_MINUTES <= range.end; at += CELL_MINUTES) cells.add(at);
  }
  return cells;
}

/** The weekly hours for one weekday, as plain stretches. */
export const rangesOn = (hours: readonly HoursRange[], weekday: Weekday): DayRange[] => hours.filter((one) => one.weekday === weekday).map((one) => ({ start: one.start, end: one.end }));

/** Whether two days' stretches cover the same cells. */
export function sameCells(a: readonly DayRange[], b: readonly DayRange[]): boolean {
  const x = cellsFromRanges(a);
  const y = cellsFromRanges(b);
  return x.size === y.size && [...x].every((one) => y.has(one));
}

/** "9:00 AM to 9:30 AM": what a cell is called to a screen reader. */
export const cellLabel = (at: number): string => `${clockLabel(at)} to ${clockLabel(at + CELL_MINUTES)}`;

/** Reads painted cells from a form: fields named `c-<column>-<minutes>` with the value "1". */
export function paintedIn(form: Readonly<Record<string, string>>, column: string): number[] {
  const prefix = `c-${column}-`;
  return Object.entries(form)
    .filter(([key, value]) => key.startsWith(prefix) && value === "1")
    .map(([key]) => Number(key.slice(prefix.length)))
    .filter((at) => Number.isInteger(at));
}

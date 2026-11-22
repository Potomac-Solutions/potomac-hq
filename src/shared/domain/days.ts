// Days as a client reads them. "2026-11-21" is how HQ stores a day. A
// client sees "Sat, Nov 21", and how far off it is.
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function utc(day: string): Date | null {
  const match = DAY.exec(day);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === day ? date : null;
}

/** "Sat, Nov 21", with the year when it is not this year's. Text that is not a day is given back as it was. */
export function friendlyDay(day: string, today: string): string {
  const date = utc(day);
  if (!date) return day;
  const text = `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  return day.slice(0, 4) === today.slice(0, 4) ? text : `${text}, ${day.slice(0, 4)}`;
}

/** Whole days from today to a day. Negative when it has passed. Null when either is not a day. */
export function daysUntil(day: string, today: string): number | null {
  const then = utc(day);
  const now = utc(today);
  return then && now ? Math.round((then.getTime() - now.getTime()) / 86_400_000) : null;
}

/** "today", "tomorrow", "in 5 days", "yesterday", "3 days ago". */
export function howSoon(day: string, today: string): string {
  const days = daysUntil(day, today);
  if (days === null) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** "Sat, Nov 21, in 5 days". For something that is still to come or was due. */
export function dueText(day: string, today: string): string {
  const soon = howSoon(day, today);
  return soon ? `${friendlyDay(day, today)}, ${soon}` : friendlyDay(day, today);
}

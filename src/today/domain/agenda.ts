// The day's list: everything that wants doing today, from every part of HQ,
// in one order. Calls at their time come first, then what clients are
// waiting on, sites that are down, anything overdue (oldest first), then
// today's follow-ups, to-dos and deadlines, opportunities going cold, and
// renewals this week.

export const AGENDA_KINDS = ["call", "waiting", "site", "follow-up", "todo", "deadline", "cold", "renewal"] as const;
export type AgendaKind = (typeof AGENDA_KINDS)[number];
export const AGENDA_LABELS: Readonly<Record<AgendaKind, string>> = {
  call: "Call",
  waiting: "Waiting on you",
  site: "Site down",
  "follow-up": "Follow up",
  todo: "To-do",
  deadline: "Deadline",
  cold: "Going cold",
  renewal: "Renewal",
};

export type AgendaItem = {
  readonly key: string;
  readonly kind: AgendaKind;
  readonly text: string;
  readonly detail: string;
  readonly href: string;
  /** What the link does: "Open", "Log a call", "Reply". */
  readonly action: string;
  readonly overdue: boolean;
  /** For ordering inside its place: a time for a call, a day for the rest. */
  readonly at: string;
  /** A to-do can be ticked off right on the list. */
  readonly todoId: string;
};

const rank = (item: AgendaItem): number => {
  if (item.kind === "call") return 0;
  if (item.kind === "waiting") return 1;
  if (item.kind === "site") return 2;
  if (item.overdue) return 3;
  return 4 + AGENDA_KINDS.indexOf(item.kind);
};

/** The list in the order to work it. */
export function orderAgenda(items: readonly AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.at < b.at ? -1 : a.at > b.at ? 1 : a.text.localeCompare(b.text)));
}

/** One line to open the page or the email with. */
export function headline(items: readonly AgendaItem[]): string {
  if (items.length === 0) return "Nothing due today. A good day to find new work.";
  const overdue = items.filter((one) => one.overdue).length;
  const calls = items.filter((one) => one.kind === "call").length;
  const parts = [`${items.length} ${items.length === 1 ? "thing" : "things"} today`];
  if (calls > 0) parts.push(`${calls} ${calls === 1 ? "call" : "calls"} booked`);
  if (overdue > 0) parts.push(`${overdue} overdue`);
  return parts.join(", ") + ".";
}

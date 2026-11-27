// The Trash (decision 0023): what can be deleted, when it may be, and how
// long it is kept to be put back. A delete takes the record and everything
// that belongs to it; the rules here decide on the counts, not on tables.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const TRASH_KINDS = ["client", "contact", "opportunity", "proposal", "project"] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];
export const isTrashKind = (value: string): value is TrashKind => (TRASH_KINDS as readonly string[]).includes(value);

/** Days a deleted record is kept in the Trash before it is purged for good. */
export const TRASH_DAYS = 30;

/** The most records one delete may take at once, so a page of ticks can't time out. */
export const MAX_AT_ONCE = 100;

export const KIND_LABELS: Readonly<Record<TrashKind, { readonly one: string; readonly many: string }>> = {
  client: { one: "client", many: "clients" },
  contact: { one: "contact", many: "contacts" },
  opportunity: { one: "deal", many: "deals" },
  proposal: { one: "proposal", many: "proposals" },
  project: { one: "project", many: "projects" },
};

export const countOf = (kind: TrashKind, n: number): string => `${n} ${n === 1 ? KIND_LABELS[kind].one : KIND_LABELS[kind].many}`;

/** What a delete would take with it, before it is done. */
export type DeletePlan = {
  readonly kind: TrashKind;
  readonly id: string;
  readonly label: string;
  /** The client it is at; empty for a client itself, or for company work. */
  readonly clientName: string;
  /** Whether the client it belongs to is marked a demo. */
  readonly demo: boolean;
  /** Rows that would go, by table. */
  readonly counts: Readonly<Record<string, number>>;
};

/**
 * Money records: a payment recorded, or a proposal signed. A real client's
 * are kept, since an accountant may need them; a demo's may go (decision
 * 0023). Mark a real client Former instead.
 */
export function mayDelete(plan: DeletePlan): Result<true, "has-money"> {
  if (plan.demo) return ok(true);
  const payments = plan.counts["payment"] ?? 0;
  const signed = plan.counts["agreement"] ?? 0;
  return payments + signed > 0 ? err("has-money") : ok(true);
}

/** Why a delete was refused, in words, for the confirm page. */
export function moneyReason(plan: DeletePlan): string {
  const payments = plan.counts["payment"] ?? 0;
  const signed = plan.counts["agreement"] ?? 0;
  const parts = [payments > 0 ? `${payments} payment${payments === 1 ? "" : "s"} recorded` : "", signed > 0 ? `${signed} signed agreement${signed === 1 ? "" : "s"}` : ""].filter(Boolean);
  return `${parts.join(" and ")}. Real money records stay. Mark the client Former instead, or mark it a demo if it was only ever a test.`;
}

// What goes with a record, named for people. Tables not listed here are
// counted as "other records".
const NAMED: readonly (readonly [string, string, string])[] = [
  ["contact", "contact", "contacts"],
  ["opportunity", "deal", "deals"],
  ["proposal", "proposal", "proposals"],
  ["project", "project", "projects"],
  ["task", "task", "tasks"],
  ["time_entry", "time entry", "time entries"],
  ["expense", "expense", "expenses"],
  ["invoice", "invoice", "invoices"],
  ["payment", "payment", "payments"],
  ["agreement", "signed agreement", "signed agreements"],
  ["deliverable", "deliverable", "deliverables"],
  ["file", "file", "files"],
  ["note", "note", "notes"],
  ["client_user", "portal person", "portal people"],
  ["booking", "booking", "bookings"],
  ["renewal", "renewal", "renewals"],
];

/** "2 projects, 14 tasks, 3 invoices and 40 other records", leaving out the record itself. */
export function describeCounts(counts: Readonly<Record<string, number>>, rootTable: string): string {
  const left = { ...counts, [rootTable]: Math.max(0, (counts[rootTable] ?? 0) - 1) };
  const parts: string[] = [];
  let other = 0;
  const named = new Set(NAMED.map(([table]) => table));
  for (const [table, one, many] of NAMED) {
    const n = left[table] ?? 0;
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  for (const [table, n] of Object.entries(left)) if (!named.has(table)) other += n;
  if (other > 0) parts.push(`${other} other record${other === 1 ? "" : "s"}`);
  if (parts.length === 0) return "nothing else";
  return parts.length === 1 ? (parts[0] as string) : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Whether a trash row deleted at `deletedAt` is due to be purged at `now` (ISO instants). */
export function purgeDue(deletedAt: string, now: string): boolean {
  return Date.parse(now) - Date.parse(deletedAt) >= TRASH_DAYS * 24 * 60 * 60 * 1000;
}

/** Days left before a trash row is purged, at least 0. */
export function daysLeft(deletedAt: string, now: string): number {
  const left = TRASH_DAYS - (Date.parse(now) - Date.parse(deletedAt)) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(left));
}

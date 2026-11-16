// The audit history's filters, as someone typed them into the address, made
// safe to search with. Anything that is not a valid filter is dropped, so a
// bad address shows everything and never an error.
export const AUDIT_PAGE_SIZE = 50;

export type AuditQuery = {
  readonly actor: string;
  readonly recordType: string;
  readonly action: string;
  /** Days, YYYY-MM-DD, both included. */
  readonly from: string;
  readonly to: string;
  readonly page: number;
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[a-z][a-z0-9.-]{0,60}$/;

function isDay(text: string): boolean {
  if (!DAY.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

export function auditQuery(raw: { readonly actor?: string; readonly recordType?: string; readonly action?: string; readonly from?: string; readonly to?: string; readonly page?: string }): AuditQuery {
  const actor = (raw.actor ?? "").trim();
  const recordType = (raw.recordType ?? "").trim();
  const action = (raw.action ?? "").trim().toLowerCase();
  const from = (raw.from ?? "").trim();
  const to = (raw.to ?? "").trim();
  const page = /^\d{1,5}$/.test(raw.page ?? "") ? Math.max(1, Number(raw.page)) : 1;
  return {
    actor: actor === "none" || ID.test(actor) ? actor : "",
    recordType: NAME.test(recordType) ? recordType : "",
    action: NAME.test(action) ? action : "",
    from: isDay(from) ? from : "",
    to: isDay(to) ? to : "",
    page,
  };
}

/** The day after a day, YYYY-MM-DD. */
export function dayAfter(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
}

/** A context's entries as "name: value" text, for the detail line. Long values are cut. */
export function contextLine(context: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(context);
  } catch {
    return "";
  }
  if (typeof parsed !== "object" || parsed === null) return "";
  return Object.entries(parsed as Record<string, unknown>)
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}: ${text.length > 80 ? `${text.slice(0, 77)}...` : text}`;
    })
    .join(" · ");
}

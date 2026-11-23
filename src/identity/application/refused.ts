// Refused attempts (security review, known gap 4): a wrong password at
// either sign-in, a wrong two-factor code, and a form someone signed in was
// not allowed to use. They go to their own log, not the activity log: the
// activity log is kept for good, and these can come from anyone. Tries past a
// rate limit are not recorded one by one, so a flood is bounded.
import { authorize } from "./authorize.ts";
import { err, ok, type Clock, type Id, type IdSource, type Result } from "../../shared/index.ts";
import type { RefusedKind, RefusedLog, UserStore } from "./ports.ts";

const SHOWN_DAYS = 30;
const SHOWN_MOST = 200;

export type RefusedDeps = {
  readonly users: UserStore;
  readonly refused: RefusedLog;
  readonly clock: Clock;
  readonly newId: IdSource;
  readonly formatWhen: (instant: string) => string;
};

export type RefusedDraft = { readonly kind: RefusedKind; readonly userId?: Id | null; readonly email?: string | null; readonly address: string; readonly detail: string };

/** Records one. Never throws: a refusal is answered whether or not it could be written down. */
export function recordRefusal(deps: Pick<RefusedDeps, "refused" | "clock" | "newId">, draft: RefusedDraft): void {
  const email = draft.email ? draft.email.trim().toLowerCase().slice(0, 254) : null;
  try {
    deps.refused.append({ id: deps.newId(), occurredAt: deps.clock(), kind: draft.kind, userId: draft.userId ?? null, email: email || null, address: draft.address.slice(0, 64) || "unknown", detail: draft.detail.slice(0, 200) });
  } catch {
    // The request log still has it.
  }
}

const LABELS: Readonly<Record<RefusedKind, string>> = {
  "sign-in": "HQ sign-in",
  "second-step": "Two-factor code",
  "portal-sign-in": "Portal sign-in",
  permission: "Not allowed",
};

const DETAILS: Readonly<Record<string, string>> = {
  refused: "Password refused: wrong, no such account, or locked",
  wrong: "Wrong password, or no such account",
  locked: "Locked after too many wrong tries",
  "code-wrong": "Wrong code",
  "code-used": "A code that was already used",
  "code-invalid": "Not a code",
};

export type RefusedView = {
  readonly total: number;
  readonly shown: number;
  readonly days: number;
  readonly items: readonly { readonly id: string; readonly when: string; readonly whenIso: string; readonly kind: string; readonly who: string; readonly address: string; readonly detail: string }[];
};

/** The last 30 days, newest first. Permission: `activity.view-all`. */
export function refusedAttempts(deps: RefusedDeps, actorId: Id | null): Result<RefusedView, "forbidden"> {
  if (!authorize(deps, actorId, "activity.view-all").ok) return err("forbidden");
  const from = Temporal.Instant.from(deps.clock()).subtract({ hours: 24 * SHOWN_DAYS }).toString();
  const rows = deps.refused.since(from, SHOWN_MOST);
  const names = new Map<string, string>();
  const nameOf = (id: Id) => {
    if (!names.has(id)) names.set(id, deps.users.get(id)?.name ?? "A removed user");
    return names.get(id) as string;
  };
  return ok({
    total: deps.refused.countSince(from),
    shown: rows.length,
    days: SHOWN_DAYS,
    items: rows.map((row) => ({
      id: row.id,
      when: deps.formatWhen(row.occurredAt),
      whenIso: row.occurredAt,
      kind: LABELS[row.kind],
      who: row.userId ? nameOf(row.userId) : (row.email ?? "Nobody named"),
      address: row.address,
      detail: DETAILS[row.detail] ?? row.detail,
    })),
  });
}

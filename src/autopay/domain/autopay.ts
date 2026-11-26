// When an autopay invoice is tried (2026-11-26): the day it's sent, then
// three days and seven days after the first try if declined. A try with no
// clear answer is never repeated automatically.

export type Try = { readonly triedOn: string; readonly outcome: "trying" | "paid" | "declined" | "unknown" };

export const RETRY_AFTER_DAYS = [3, 7] as const;
export const MAX_TRIES = 1 + RETRY_AFTER_DAYS.length;

export type NextTry = { readonly now: true } | { readonly now: false; readonly why: "paid" | "wait" | "out-of-tries" | "unclear" };

export function nextTry(tries: readonly Try[], today: string): NextTry {
  if (tries.some((one) => one.outcome === "paid")) return { now: false, why: "paid" };
  if (tries.some((one) => one.outcome === "unknown" || one.outcome === "trying")) return { now: false, why: "unclear" };
  if (tries.length === 0) return { now: true };
  if (tries.length >= MAX_TRIES) return { now: false, why: "out-of-tries" };
  const first = [...tries].sort((a, b) => a.triedOn.localeCompare(b.triedOn))[0] as Try;
  const after = RETRY_AFTER_DAYS[tries.length - 1] as number;
  const due = Temporal.PlainDate.from(first.triedOn).add({ days: after }).toString();
  return today >= due ? { now: true } : { now: false, why: "wait" };
}

/** True after the last try is declined: time for a person to step in. */
export const lastTryDeclined = (tries: readonly Try[]) => tries.length >= MAX_TRIES && tries.every((one) => one.outcome === "declined");

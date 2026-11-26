// Pins (decision 0015, follow-up): a person pins the page they're on to the
// top of their sidebar, or unpins it. Anyone signed in, for themselves only.
import { cleanHref, MAX_PINS, pinnable, type Pin } from "../domain/pins.ts";
import type { IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

export type PinStore = {
  list(userId: Id): Pin[];
  add(userId: Id, pin: Pin, at: string): void;
  remove(userId: Id, href: string): boolean;
};

export type PinsDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly pins: PinStore;
  /** What a page is called, for this person: null when it isn't one they may open. */
  readonly labelFor: (actorId: Id, href: string) => string | null;
};

const signedIn = (deps: PinsDeps, actorId: Id | null): actorId is Id => actorId !== null && deps.users.get(actorId)?.status === "active";

export const pinsFor = (deps: PinsDeps, actorId: Id | null): readonly Pin[] => (signedIn(deps, actorId) ? deps.pins.list(actorId) : []);

/** Pins the page, or unpins it if it was pinned. True when it is now pinned. */
export function togglePin(deps: PinsDeps, actorId: Id | null, raw: string): Result<boolean, "forbidden" | "not-pinnable" | "too-many-pins"> {
  if (!signedIn(deps, actorId)) return err("forbidden");
  const href = cleanHref(raw);
  if (!pinnable(href)) return err("not-pinnable");
  return deps.transact(() => {
    if (deps.pins.remove(actorId, href)) {
      recordActivity(deps, { actorId, action: "nav.unpinned", recordType: "user", recordId: actorId, context: { href } });
      return ok(false);
    }
    const label = deps.labelFor(actorId, href);
    if (label === null) return err("not-pinnable");
    if (deps.pins.list(actorId).length >= MAX_PINS) return err("too-many-pins");
    deps.pins.add(actorId, { href, label }, deps.clock());
    recordActivity(deps, { actorId, action: "nav.pinned", recordType: "user", recordId: actorId, context: { href } });
    return ok(true);
  });
}

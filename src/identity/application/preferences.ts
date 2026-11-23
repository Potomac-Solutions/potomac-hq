// A person's own settings. Like changing your own password, choosing your
// theme or the morning email needs no permission (authorization matrix: key
// "none"), but it must be you, and it is recorded.
import { isTheme, type Theme } from "../domain/theme.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { UserStore } from "./ports.ts";

export type PreferenceDeps = ActivityDeps & { readonly users: UserStore; readonly transact: Transact };

export function changeTheme(deps: PreferenceDeps, actorId: Id | null, theme: string): Result<{ id: Id; theme: Theme }, "forbidden" | "invalid-theme"> {
  const access = actorId === null ? null : deps.users.accessFor(actorId);
  if (actorId === null || access === null || access.user.status !== "active") return err("forbidden");
  if (!isTheme(theme)) return err("invalid-theme");
  return deps.transact(() => {
    deps.users.setTheme(actorId, theme, deps.clock());
    recordActivity(deps, { actorId, action: "user.theme-changed", recordType: "user", recordId: actorId, context: { theme } });
    return ok({ id: actorId, theme });
  });
}

/** Turns your own morning email of the Today list on or off. */
export function changeMorningEmail(deps: PreferenceDeps, actorId: Id | null, on: boolean): Result<{ id: Id; on: boolean }, "forbidden"> {
  const access = actorId === null ? null : deps.users.accessFor(actorId);
  if (actorId === null || access === null || access.user.status !== "active") return err("forbidden");
  return deps.transact(() => {
    deps.users.setMorningEmail(actorId, on, deps.clock());
    recordActivity(deps, { actorId, action: on ? "user.morning-email-on" : "user.morning-email-off", recordType: "user", recordId: actorId });
    return ok({ id: actorId, on });
  });
}

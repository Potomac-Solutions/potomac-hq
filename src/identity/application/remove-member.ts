// Removing a member from HQ (decision 0025): their open work goes to someone
// chosen, what was only theirs is deleted, their sign-in is retired, and
// their row stays so past work still names them.
import { mayStopBeingAdmin, retiredEmail, type ChangeRefused } from "../domain/user.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import { authorize } from "./authorize.ts";
import type { AccountAdmin, MemberRecords, OpenWork, UserStore } from "./ports.ts";

export type RemoveMemberDeps = ActivityDeps & {
  readonly users: UserStore;
  readonly accounts: AccountAdmin;
  readonly members: MemberRecords;
  readonly transact: Transact;
};

export type RemoveRefused = "forbidden" | "not-found" | ChangeRefused | "no-one-to-take-over" | "refused";

/** One line of open work, in words, for the page. */
export type WorkLine = { readonly key: string; readonly label: string };

export type RemovalView = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly work: readonly WorkLine[];
  /** Who may take the work over: everyone active but them, the remover first. */
  readonly takers: readonly { readonly id: string; readonly name: string; readonly you: boolean }[];
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What open work says, in words. Kinds with none are left out. */
export function workLines(work: OpenWork): WorkLine[] {
  const lines: WorkLine[] = [];
  if (work.deals) lines.push({ key: "deals", label: plural(work.deals, "open deal", "open deals") });
  if (work.projects) lines.push({ key: "projects", label: plural(work.projects, "active project they own", "active projects they own") });
  if (work.tasks) lines.push({ key: "tasks", label: plural(work.tasks, "task not done", "tasks not done") });
  if (work.todos) lines.push({ key: "todos", label: plural(work.todos, "to-do not done", "to-dos not done") });
  if (work.calls) lines.push({ key: "calls", label: plural(work.calls, "upcoming call they host", "upcoming calls they host") });
  if (work.bookingHost) lines.push({ key: "bookingHost", label: "The booking calendar: they host the calls clients book" });
  if (work.sharedFilters) lines.push({ key: "sharedFilters", label: plural(work.sharedFilters, "shared filter", "shared filters") });
  if (work.timers) lines.push({ key: "timers", label: plural(work.timers, "running timer, stopped now and kept", "running timers, stopped now and kept") });
  return lines;
}

/** The refusal removing this person would meet, if any. */
function refusal(deps: RemoveMemberDeps, actorId: Id, userId: Id): Result<{ readonly name: string; readonly email: string; readonly staffAccount: string }, RemoveRefused> {
  const user = deps.users.get(userId);
  if (!user || user.removedAt) return err("not-found");
  if (user.id === actorId) return err("yourself");
  const isAdmin = deps.users.rolesOf(user.id).includes("admin");
  if (!mayStopBeingAdmin({ isAdmin, status: user.status }, deps.users.activeAdminsOtherThan(user.id))) return err("last-admin");
  return ok(user);
}

const takersFor = (deps: RemoveMemberDeps, actorId: Id, userId: Id) =>
  deps.users
    .list()
    .filter((one) => one.status === "active" && one.id !== userId)
    .map((one) => ({ id: one.id as string, name: one.name, you: one.id === actorId }))
    .sort((a, b) => Number(b.you) - Number(a.you));

/** The page before removing someone: their open work, and who could take it. */
export function removalFor(deps: RemoveMemberDeps, actorId: Id | null, userId: Id): Result<RemovalView, RemoveRefused> {
  if (actorId === null || !authorize(deps, actorId, "user.remove").ok) return err("forbidden");
  const found = refusal(deps, actorId, userId);
  if (!found.ok) return found;
  return ok({ id: userId, name: found.value.name, email: found.value.email, work: workLines(deps.members.openWork(userId, deps.clock())), takers: takersFor(deps, actorId, userId) });
}

/**
 * Removes someone from HQ. Their open work goes to `takerId`, who must be
 * active and not them; with no work to hand over, it may be anyone active.
 * The sign-in account is retired first: if that is refused, nothing changes.
 */
export async function removeMember(deps: RemoveMemberDeps, actorId: Id | null, userId: Id, takerId: Id | null): Promise<Result<{ readonly name: string; readonly moved: OpenWork; readonly takerName: string }, RemoveRefused>> {
  if (actorId === null || !authorize(deps, actorId, "user.remove").ok) return err("forbidden");
  const found = refusal(deps, actorId, userId);
  if (!found.ok) return found;
  const taker = takerId ? takersFor(deps, actorId, userId).find((one) => one.id === takerId) : null;
  if (!taker) return err("no-one-to-take-over");
  const email = retiredEmail(userId);
  if (!(await deps.accounts.retire(found.value.staffAccount, email))) return err("refused");
  return deps.transact(() => {
    const at = deps.clock();
    const moved = deps.members.handOver(userId, taker.id as Id, at);
    deps.members.forget(userId);
    deps.users.markRemoved(userId, email, at);
    recordActivity(deps, { actorId, action: "user.removed", recordType: "user", recordId: userId, context: { handedTo: taker.id, ...moved } });
    return ok({ name: found.value.name, moved, takerName: taker.name });
  });
}

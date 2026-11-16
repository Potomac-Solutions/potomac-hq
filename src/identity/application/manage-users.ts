// Managing who can sign in to HQ: invite someone, change their roles, switch
// them off, and make them a new link. Each checks its permission first and
// writes an activity event (docs/authorization-matrix.md, "Users").
import { ROLE_KEYS, type RoleKey } from "../domain/permissions.ts";
import { cleanRoles, mayStopBeingAdmin, newInvite, newUser, type ChangeRefused, type RolesError, type User, type UserError, type UserInvite } from "../domain/user.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import { authorize } from "./authorize.ts";
import type { AccountAdmin, InviteStore, UserStore } from "./ports.ts";

export type ManageUsersDeps = ActivityDeps & {
  readonly users: UserStore;
  readonly invites: InviteStore;
  readonly accounts: AccountAdmin;
  readonly transact: Transact;
};

export const ROLE_LABELS: Readonly<Record<RoleKey, string>> = { admin: "Admin", manager: "Manager", member: "Member" };

export type PersonView = { readonly id: string; readonly name: string; readonly email: string; readonly active: boolean; readonly statusLabel: string; readonly roleLabels: string; readonly roles: readonly { readonly key: string; readonly label: string; readonly held: boolean }[]; readonly you: boolean };
export type InviteView = { readonly id: string; readonly name: string; readonly email: string; readonly roleLabels: string };
export type PeopleView = {
  readonly people: readonly PersonView[];
  readonly invites: readonly InviteView[];
  readonly roles: readonly { readonly key: string; readonly label: string }[];
  readonly can: { readonly invite: boolean; readonly setStatus: boolean; readonly setRoles: boolean; readonly reset: boolean };
};

const labels = (roles: readonly RoleKey[]) => roles.map((key) => ROLE_LABELS[key]).join(", ");

export function listPeople(deps: ManageUsersDeps, actorId: Id | null): Result<PeopleView, "forbidden"> {
  if (!authorize(deps, actorId, "user.view").ok) return err("forbidden");
  const may = (action: string) => authorize(deps, actorId, action).ok;
  const can = { invite: may("user.invite"), setStatus: may("user.set-status"), setRoles: may("user.set-roles"), reset: may("user.reset") };
  return ok({
    people: deps.users.list().map((user) => {
      const held = deps.users.rolesOf(user.id);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        active: user.status === "active",
        statusLabel: user.status === "active" ? "Active" : "Turned off",
        roleLabels: labels(held) || "No role",
        roles: ROLE_KEYS.map((key) => ({ key, label: ROLE_LABELS[key], held: held.includes(key) })),
        you: user.id === actorId,
      };
    }),
    // Who is waiting on an invite is for those who can invite.
    invites: can.invite ? deps.invites.list().map((invite) => ({ id: invite.id, name: invite.name, email: invite.email, roleLabels: labels(invite.roles) })) : [],
    roles: ROLE_KEYS.map((key) => ({ key, label: ROLE_LABELS[key] })),
    can,
  });
}

/** A one-time link: the address a person opens to choose their password. */
export type UserLink = { readonly name: string; readonly email: string; readonly path: string };

export type InviteRefused = "forbidden" | UserError | RolesError | "already-a-user" | "already-invited";

/**
 * Invites someone to HQ with these roles. Their user is made when they use
 * the link. The link is answered to the caller, who emails it or shows it
 * once. It is never written to the audit log.
 */
export async function inviteUser(deps: ManageUsersDeps, actorId: Id | null, input: { readonly name: string; readonly email: string; readonly roles: readonly string[] }): Promise<Result<UserLink, InviteRefused>> {
  if (actorId === null || !authorize(deps, actorId, "user.invite").ok) return err("forbidden");
  const invite = newInvite({ id: deps.newId(), invitedBy: actorId, ...input });
  if (!invite.ok) return invite;
  if (deps.users.findByEmail(invite.value.email)) return err("already-a-user");
  if (deps.invites.byEmail(invite.value.email)) return err("already-invited");
  const token = await deps.accounts.invite(invite.value.email, invite.value.name);
  if (token === null) return err("already-a-user");
  deps.transact(() => {
    deps.invites.insert(invite.value, deps.clock());
    recordActivity(deps, { actorId, action: "user.invited", recordType: "user-invite", recordId: invite.value.id, context: { roles: invite.value.roles } });
  });
  return ok({ name: invite.value.name, email: invite.value.email, path: `/staff/accept?token=${token}` });
}

/** Takes back an invite nobody has used. Its link stops making a user. */
export function withdrawInvite(deps: ManageUsersDeps, actorId: Id | null, inviteId: Id): Result<UserInvite, "forbidden" | "not-found"> {
  if (!authorize(deps, actorId, "user.invite").ok) return err("forbidden");
  return deps.transact(() => {
    const invite = deps.invites.get(inviteId);
    if (!invite) return err("not-found");
    deps.invites.remove(invite.id);
    recordActivity(deps, { actorId, action: "user.invite-withdrawn", recordType: "user-invite", recordId: invite.id });
    return ok(invite);
  });
}

/**
 * Called when someone signs in with an account HQ has no user for. If they
 * were invited, this makes their user with the invited roles. The person
 * who invited them held `user.invite` then, which is the permission here.
 */
export function acceptInvite(deps: ManageUsersDeps, who: { readonly account: string; readonly name: string; readonly email: string }): User | null {
  return deps.transact(() => {
    const invite = deps.invites.byEmail(who.email.trim().toLowerCase());
    if (!invite) return null;
    const user = newUser({ id: deps.newId(), staffAccount: who.account, name: who.name.trim() || invite.name, email: invite.email });
    if (!user.ok) return null;
    deps.users.insert(user.value, invite.roles, deps.clock());
    deps.invites.remove(invite.id);
    recordActivity(deps, { actorId: user.value.id, action: "user.created", recordType: "user", recordId: user.value.id, context: { roles: invite.roles, invitedBy: invite.invitedBy } });
    return user.value;
  });
}

export async function issueUserLink(deps: ManageUsersDeps, actorId: Id | null, userId: Id): Promise<Result<UserLink, "forbidden" | "not-found" | "turned-off">> {
  if (!authorize(deps, actorId, "user.reset").ok) return err("forbidden");
  const user = deps.users.get(userId);
  if (!user) return err("not-found");
  if (user.status !== "active") return err("turned-off");
  const token = await deps.accounts.resetLink(user.staffAccount);
  if (token === null) return err("not-found");
  deps.transact(() => {
    recordActivity(deps, { actorId, action: "user.reset-link-issued", recordType: "user", recordId: user.id });
  });
  return ok({ name: user.name, email: user.email, path: `/staff/accept?token=${token}` });
}

type Change = "forbidden" | "not-found" | ChangeRefused | "refused";

/** Switches a user off, which ends their sessions at once, or back on. */
export async function setUserStatus(deps: ManageUsersDeps, actorId: Id | null, userId: Id, active: boolean): Promise<Result<User, Change>> {
  if (!authorize(deps, actorId, "user.set-status").ok) return err("forbidden");
  const user = deps.users.get(userId);
  if (!user) return err("not-found");
  if ((user.status === "active") === active) return ok(user);
  if (!active) {
    if (user.id === actorId) return err("yourself");
    const isAdmin = deps.users.rolesOf(user.id).includes("admin");
    if (!mayStopBeingAdmin({ isAdmin, status: user.status }, deps.users.activeAdminsOtherThan(user.id))) return err("last-admin");
  }
  if (!(await deps.accounts.setDisabled(user.staffAccount, !active))) return err("refused");
  const status = active ? "active" : "disabled";
  deps.transact(() => {
    deps.users.setStatus(user.id, status, deps.clock());
    recordActivity(deps, { actorId, action: active ? "user.enabled" : "user.disabled", recordType: "user", recordId: user.id });
  });
  return ok({ ...user, status });
}

export async function setUserRoles(deps: ManageUsersDeps, actorId: Id | null, userId: Id, given: readonly string[]): Promise<Result<User, Change | RolesError>> {
  if (!authorize(deps, actorId, "user.set-roles").ok) return err("forbidden");
  const user = deps.users.get(userId);
  if (!user) return err("not-found");
  const roles = cleanRoles(given);
  if (!roles.ok) return roles;
  const before = deps.users.rolesOf(user.id);
  if (before.join() === roles.value.join()) return ok(user);
  const wasAdmin = before.includes("admin");
  const isAdmin = roles.value.includes("admin");
  if (wasAdmin && !isAdmin && !mayStopBeingAdmin({ isAdmin: true, status: user.status }, deps.users.activeAdminsOtherThan(user.id))) return err("last-admin");
  if (wasAdmin !== isAdmin && !(await deps.accounts.setAdmin(user.staffAccount, isAdmin))) return err("refused");
  deps.transact(() => {
    deps.users.setRoles(user.id, roles.value, deps.clock());
    recordActivity(deps, { actorId, action: "user.roles-changed", recordType: "user", recordId: user.id, context: { from: before, to: roles.value } });
  });
  return ok(user);
}

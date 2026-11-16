import type { Access } from "../domain/access.ts";
import type { RoleKey } from "../domain/permissions.ts";
import type { Theme } from "../domain/theme.ts";
import type { User, UserInvite, UserStatus } from "../domain/user.ts";
import type { Id } from "../../shared/index.ts";

export type UserStore = {
  /** How many users exist, of any status. */
  count(): number;
  /** Saves a new user with these roles. */
  insert(user: User, roles: readonly RoleKey[], at: string): void;
  /** The stored user and the permissions their stored roles grant, or null. */
  accessFor(userId: Id): Access | null;
  /** The user who signs in with this kit staff account, or null. */
  findByStaffAccount(staffAccount: string): User | null;
  get(userId: Id): User | null;
  /** Every user, by name. */
  list(): User[];
  /** The theme a user chose, or "system" if they never chose. */
  themeOf(userId: Id): Theme;
  setTheme(userId: Id, theme: Theme, at: string): void;
  findByEmail(email: string): User | null;
  rolesOf(userId: Id): RoleKey[];
  /** Replaces a user's roles. */
  setRoles(userId: Id, roles: readonly RoleKey[], at: string): void;
  setStatus(userId: Id, status: UserStatus, at: string): void;
  /** How many active users hold the admin role, leaving one person out. */
  activeAdminsOtherThan(userId: Id): number;
};

/** Invites nobody has used yet. */
export type InviteStore = {
  insert(invite: UserInvite, at: string): void;
  byEmail(email: string): UserInvite | null;
  get(id: Id): UserInvite | null;
  list(): (UserInvite & { readonly createdAt: string })[];
  remove(id: Id): void;
  /** Removes invites made before this instant. Answers how many. */
  removeOlderThan(instant: string): number;
};

/**
 * HQ's own sign-in accounts: one-time links, and switching an account off.
 * The kit's staff module keeps them (decision 0001).
 */
export type AccountAdmin = {
  /** A one-time invite link token. Null if that email already has an account. */
  invite(email: string, name: string): Promise<string | null>;
  /** A one-time link token to set a new password. Null if the account cannot have one. */
  resetLink(staffAccount: string): Promise<string | null>;
  /** Switches an account off (its sessions end at once) or back on. False if refused. */
  setDisabled(staffAccount: string, disabled: boolean): Promise<boolean>;
  /** Keeps the account's standing in step with the admin role. False if refused. */
  setAdmin(staffAccount: string, admin: boolean): Promise<boolean>;
};

/** True if this key may make another attempt now. */
export type RateLimit = (key: string) => boolean;

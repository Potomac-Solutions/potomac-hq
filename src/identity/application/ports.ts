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
  /** Spends every unused invite link for this email, so none of them makes an account. Answers how many. */
  spendInviteLinks(email: string): number;
};

/** True if this key may make another attempt now. */
export type RateLimit = (key: string) => boolean;

/** The cryptography two-factor sign-in needs (infrastructure/totp.ts). */
export type TwoFactorCrypto = {
  newSecret(): string;
  /** The 30-second step a code is right for, near this instant, or null. */
  verify(secret: string, code: string, atMs: number): number | null;
  newRecoveryCode(): string;
  hash(text: string): string;
};

export type TwoFactorRecord = { readonly userId: Id; readonly secret: string; readonly confirmed: boolean; readonly lastStep: number };

export type TwoFactorStore = {
  get(userId: Id): TwoFactorRecord | null;
  /** Starts again from nothing: a new secret, not confirmed, no recovery codes. */
  begin(userId: Id, secret: string, at: string): void;
  confirm(userId: Id, step: number, recoveryHashes: readonly string[], at: string): void;
  setLastStep(userId: Id, step: number, at: string): void;
  /** Uses a recovery code. False when there is no such unused code. */
  useRecovery(userId: Id, codeHash: string, at: string): boolean;
  recoveryLeft(userId: Id): number;
  /** Turns it off: the secret, the recovery codes and every passed session go. */
  remove(userId: Id): void;
  markSession(sessionHash: string, userId: Id, at: string): void;
  sessionPassed(sessionHash: string, userId: Id): boolean;
  /** Whether every admin must have it on. */
  requiredForAdmins(): boolean;
  setRequiredForAdmins(on: boolean, by: Id, at: string): void;
};

export type RefusedKind = "sign-in" | "second-step" | "portal-sign-in" | "permission";

export type RefusedAttempt = {
  readonly id: Id;
  readonly occurredAt: string;
  readonly kind: RefusedKind;
  readonly userId: Id | null;
  readonly email: string | null;
  readonly address: string;
  readonly detail: string;
};

/** Refused attempts: kept apart from the activity log, for 90 days. */
export type RefusedLog = {
  append(attempt: RefusedAttempt): void;
  /** Newest first. */
  since(instant: string, limit: number): readonly RefusedAttempt[];
  countSince(instant: string): number;
  prune(before: string): number;
};

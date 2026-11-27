// Public entry for the identity module (users, roles, sign-in). Other modules
// import from here only.
export { can, type Access } from "./domain/access.ts";
export { isPermission, isRoleKey, PERMISSIONS, ROLE_GRANTS, ROLE_KEYS, type Permission, type RoleKey } from "./domain/permissions.ts";
export type { User, UserError, UserStatus } from "./domain/user.ts";
export { authorize, type Forbidden } from "./application/authorize.ts";
export { createFirstAdmin, type CreateFirstAdminDeps, type CreateFirstAdminError } from "./application/create-first-admin.ts";
export type { UserStore } from "./application/ports.ts";
export { establishUser, recordSessionEvent, type SessionDeps, type SessionEvent, type SignedInAccount } from "./application/session.ts";
export type { RateLimit, UserStore as IdentityUserStore } from "./application/ports.ts";
export { requestPasswordReset, type AccountDirectory, type PasswordResetDeps, type ResetMailer } from "./application/password-reset.ts";
export { isTheme, THEME_LABELS, THEMES, type Theme } from "./domain/theme.ts";
export { changeMorningEmail, changeTheme, type PreferenceDeps } from "./application/preferences.ts";
export { inviteUser, issueUserLink, listPeople, ROLE_LABELS, setUserRoles, setUserStatus, withdrawInvite, type InviteView, type ManageUsersDeps, type PeopleView, type PersonView, type UserLink } from "./application/manage-users.ts";
export type { AccountAdmin, InviteStore, MemberRecords, OpenWork } from "./application/ports.ts";
export { removalFor, removeMember, workLines, type RemovalView, type RemoveMemberDeps, type RemoveRefused } from "./application/remove-member.ts";
export type { UserInvite } from "./domain/user.ts";
export { beginTwoFactor, confirmTwoFactor, needsSecondStep, passSecondStep, mustTurnOnTwoFactor, newRecoveryCodes, resetTwoFactor, setTwoFactorRule, shouldTurnOnTwoFactor, turnOffTwoFactor, twoFactorQr, twoFactorStatus, type TwoFactorDeps, type TwoFactorStatus } from "./application/two-factor.ts";
export type { TwoFactorCrypto, TwoFactorStore } from "./application/ports.ts";
export { recordRefusal, refusedAttempts, type RefusedDeps, type RefusedDraft, type RefusedView } from "./application/refused.ts";

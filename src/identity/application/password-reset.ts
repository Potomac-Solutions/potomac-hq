// "Forgot your password?" by email.
//
// Permission: none, like signing in (docs/authorization-matrix.md): anyone may
// ask. What protects it:
//   - The answer is the same whether or not the email has an account, so the
//     form cannot be used to find out who has one.
//   - Only an active HQ user is sent a link.
//   - Asking is rate limited per address and per email, in the route.
//   - The link is one-time and short-lived (the kit's reset link).
// A sent link is an activity event with no actor: nobody is signed in.
import { recordActivity, type ActivityDeps, type Transact } from "../../shared/index.ts";
import type { UserStore } from "./ports.ts";

export type AccountDirectory = {
  /** The kit account for an email, if it exists and is not turned off. */
  findActive(email: string): { readonly account: string; readonly name: string } | null;
  /** A one-time reset link token for that account, or null. */
  issueReset(account: string): Promise<string | null>;
};

export type ResetMailer = (to: string, message: { readonly name: string; readonly link: string }) => Promise<boolean>;

export type PasswordResetDeps = ActivityDeps & {
  readonly users: UserStore;
  readonly transact: Transact;
  readonly accounts: AccountDirectory;
  readonly mail: ResetMailer;
  readonly publicUrl: string;
  readonly log: (message: string, error?: unknown) => void;
};

/** Always resolves the same way. Whether a link was sent is only in the log and the audit table. */
export async function requestPasswordReset(deps: PasswordResetDeps, email: string): Promise<void> {
  const wanted = email.trim().toLowerCase();
  if (wanted.length === 0 || wanted.length > 254) return;
  const found = deps.accounts.findActive(wanted);
  if (!found) return;
  const user = deps.users.findByStaffAccount(found.account);
  if (!user || user.status !== "active") return;

  const token = await deps.accounts.issueReset(found.account);
  if (!token) return;
  const sent = await deps.mail(wanted, { name: user.name, link: `${deps.publicUrl}/staff/accept?token=${token}` });
  if (!sent) {
    deps.log(`A password reset email could not be sent to user ${user.id}.`);
    return;
  }
  deps.transact(() => {
    recordActivity(deps, { actorId: null, action: "user.reset-link-emailed", recordType: "user", recordId: user.id });
  });
}

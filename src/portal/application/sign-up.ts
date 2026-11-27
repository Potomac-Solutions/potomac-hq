// Signing up: someone new makes a portal account to book a call. Anyone on
// the internet can try, so nothing here says whether an email is known: the
// answer is always "check your email", and only the inbox's owner can go on.
// A new person becomes a prospect in the CRM, with an opportunity, and an
// invited portal user; the emailed link confirms the address and sets the
// password, like an invite from Potomac. Someone who already has an account
// is sent a link to set a new password instead. "Already" reaches past the
// exact email: the same phone number, a "+tag" or Gmail dots all find the
// person on file, and the link goes to the email on file, not the one typed.
import { newClientUser } from "../domain/client-user.ts";
import { emailKey, phoneKey } from "../domain/identity-keys.ts";
import { recordSignUp, type SignUpError, type SignUpInput } from "../../crm/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { PortalDeps } from "./staff-side.ts";

/** The link to email, and to whom; null when nothing should be sent (access turned off). */
export type SignUpLink = { readonly email: string; readonly name: string; readonly path: string; readonly kind: "new" | "invite-again" | "reset" } | null;

export async function signUpForPortal(deps: PortalDeps, ownerId: Id, input: SignUpInput): Promise<Result<SignUpLink, SignUpError>> {
  const email = input.email.trim().toLowerCase();
  const match = deps.people?.match({ email: emailKey(email), phone: phoneKey(input.phone) }) ?? null;
  if (match) {
    // Someone on file with nowhere to send a link, or turned off: nothing is sent, and the answer stays the same.
    if (match.disabled || !match.email) return ok(null);
    if (match.email !== email) return signUpForPortal(deps, ownerId, { name: match.name, email: match.email });
  }
  const known = deps.clientUsers.allByEmail(email);
  if (known.length > 0) {
    // Someone at one or more clients already: a link to their one sign-in, unless every client has turned them off.
    const existing = known.find((one) => one.status !== "disabled");
    if (!existing) return ok(null);
    const token = existing.portalAccount === null ? await deps.auth.invite(existing.email, existing.name) : await deps.auth.resetLink(existing.portalAccount);
    if (token === null) return ok(null);
    deps.transact(() => recordActivity(deps, { actorId: null, action: "client-user.sign-up-again", recordType: "client-user", recordId: existing.id, context: { organizationId: existing.organizationId } }));
    return ok({ email: existing.email, name: existing.name, path: `/portal/accept?token=${token}&next=book`, kind: existing.portalAccount === null ? "invite-again" : "reset" });
  }
  // Check the fields first, so nothing is made for a sign-up that will be refused.
  const draft = newClientUser({ id: deps.newId(), organizationId: deps.newId(), invitedBy: ownerId }, { name: input.name, email });
  if (!draft.ok) return err(draft.error === "invalid-email" ? "email-invalid" : draft.error === "name-too-long" ? "name-too-long" : "name-missing");
  // A sign-in left from clients that were deleted (decision 0023) is reused, with a link to set a new password.
  const orphan = deps.auth.accountFor(email);
  if (orphan !== null) await deps.auth.setDisabled(orphan, false);
  const token = orphan !== null ? await deps.auth.resetLink(orphan) : await deps.auth.invite(email, draft.value.name);
  if (token === null) return ok(null);
  const prospect = recordSignUp(deps, ownerId, { ...input, email });
  if (!prospect.ok) return prospect;
  const user = { ...draft.value, organizationId: prospect.value.clientId };
  deps.transact(() => {
    deps.clientUsers.insert(user, deps.clock());
    recordActivity(deps, { actorId: null, action: "client-user.signed-up", recordType: "client-user", recordId: user.id, context: { organizationId: user.organizationId, known: prospect.value.known } });
  });
  return ok({ email, name: user.name, path: `/portal/accept?token=${token}&next=book`, kind: "new" });
}

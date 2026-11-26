// Text message reminders (2026-11-26). Only to client people who said yes
// in the portal, with their own mobile number; the day-before call reminder
// and invoice reminders go by text as well as email. Nothing is sent unless
// a text provider is set up.
import { showPhone, usPhone } from "../domain/texts.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { TextSender } from "../../shared/adapters.ts";

export type TextConsent = { readonly clientUserId: Id; readonly organizationId: Id; readonly phone: string; readonly agreedAt: string; readonly stoppedAt: string | null };
export type TextPurpose = "call-reminder" | "invoice-reminder";

export type TextingStore = {
  consent(clientUserId: Id): TextConsent | null;
  agree(consent: TextConsent): void;
  stop(clientUserId: Id, at: string, by: "portal" | "reply-stop"): void;
  /** People at a client who said yes and haven't stopped. */
  forOrganization(organizationId: Id): readonly TextConsent[];
  logSent(entry: { readonly id: Id; readonly clientUserId: Id; readonly purpose: TextPurpose; readonly body: string; readonly sentAt: string; readonly outcome: string }): void;
};

export type TextingDeps = ActivityDeps & {
  readonly transact: Transact;
  readonly texts: TextingStore;
  /** null when no provider is set up: the portal doesn't offer texts then. */
  readonly sender: TextSender | null;
};

type Session = { readonly organizationId: Id; readonly clientUserId: Id };
export type PortalTexting = { readonly available: boolean; readonly on: boolean; readonly phone: string };

export function portalTexting(deps: TextingDeps, session: Session): PortalTexting {
  const consent = deps.texts.consent(session.clientUserId);
  const on = consent !== null && consent.stoppedAt === null;
  return { available: deps.sender !== null, on, phone: consent ? showPhone(consent.phone) : "" };
}

export type TextingError = "unavailable" | "phone-invalid" | "not-agreed";

/** Turns texts on for this person, with their mobile number and a yes to the terms. */
export function agreeToTexts(deps: TextingDeps, session: Session, input: { readonly phone: string; readonly agree: boolean }): Result<{ readonly phone: string }, TextingError> {
  if (deps.sender === null) return err("unavailable");
  const phone = usPhone(input.phone);
  if (!phone.ok) return phone;
  if (!input.agree) return err("not-agreed");
  deps.transact(() => {
    deps.texts.agree({ clientUserId: session.clientUserId, organizationId: session.organizationId, phone: phone.value, agreedAt: deps.clock(), stoppedAt: null });
    recordActivity(deps, { actorId: null, action: "client.texts-on", recordType: "client", recordId: session.organizationId, context: { clientUserId: session.clientUserId } });
  });
  return ok({ phone: showPhone(phone.value) });
}

export function stopTexts(deps: TextingDeps, session: Session): Result<{ readonly stopped: true }, never> {
  const consent = deps.texts.consent(session.clientUserId);
  if (consent && consent.stoppedAt === null)
    deps.transact(() => {
      deps.texts.stop(session.clientUserId, deps.clock(), "portal");
      recordActivity(deps, { actorId: null, action: "client.texts-off", recordType: "client", recordId: session.organizationId, context: { clientUserId: session.clientUserId } });
    });
  return ok({ stopped: true });
}

async function textOne(deps: TextingDeps, sender: TextSender, consent: TextConsent, purpose: TextPurpose, body: string): Promise<boolean> {
  let outcome = "sent";
  let sent = false;
  try {
    const result = await sender(consent.phone, body);
    if (result.ok) sent = true;
    else outcome = result.reason.slice(0, 60);
    // They replied STOP to the number: honour it here too.
    if (!result.ok && result.stopped) deps.transact(() => deps.texts.stop(consent.clientUserId, deps.clock(), "reply-stop"));
  } catch {
    outcome = "failed";
  }
  deps.texts.logSent({ id: deps.newId(), clientUserId: consent.clientUserId, purpose, body, sentAt: deps.clock(), outcome });
  return sent;
}

/** Texts one client person, if they said yes. Answers whether it went. */
export async function textClientPerson(deps: TextingDeps, clientUserId: Id, purpose: TextPurpose, body: string): Promise<boolean> {
  const consent = deps.texts.consent(clientUserId);
  if (!deps.sender || !consent || consent.stoppedAt !== null) return false;
  return textOne(deps, deps.sender, consent, purpose, body);
}

/** Texts everyone at a client who said yes. Answers how many it went to. */
export async function textClient(deps: TextingDeps, organizationId: Id, purpose: TextPurpose, body: string): Promise<number> {
  if (!deps.sender) return 0;
  let sent = 0;
  for (const consent of deps.texts.forOrganization(organizationId)) if (await textOne(deps, deps.sender, consent, purpose, body)) sent++;
  return sent;
}

// Someone at a client who signs in to the portal (roadmap v0.6). Separate
// from an HQ user, and tied to exactly one client organization, for good.
import { optionalEmail, optionalText, requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type ClientUserStatus = "invited" | "active" | "disabled";

export type ClientUser = {
  readonly id: Id;
  readonly organizationId: Id;
  /** The portal account they sign in with. Null until they accept their invite. */
  readonly portalAccount: string | null;
  readonly name: string;
  /** Stored lower-case. */
  readonly email: string;
  readonly status: ClientUserStatus;
  readonly invitedBy: Id;
};

/**
 * Who a portal request is from. Every portal service takes this and nothing
 * else to decide whose records to show: the organization always comes from
 * the session, never from the address or a form.
 */
export type ClientSession = {
  readonly clientUserId: Id;
  readonly organizationId: Id;
  readonly name: string;
  /**
   * Set when this is not the client but someone at Potomac looking at their
   * portal (decision 0020): the HQ user's id. Nothing can be changed in one,
   * and what it opens is logged as that user's, never as the client's.
   */
  readonly previewedBy?: Id;
};

export type InviteError = "name-missing" | "name-too-long" | "invalid-email";

export function newClientUser(ids: { readonly id: Id; readonly organizationId: Id; readonly invitedBy: Id }, input: { readonly name: string; readonly email: string }): Result<ClientUser, InviteError> {
  const name = requiredText(input.name, 80);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const email = optionalEmail(input.email);
  if (!email.ok || email.value === null) return err("invalid-email");
  return ok({ ...ids, portalAccount: null, name: name.value, email: email.value, status: "invited" });
}

/** The invite was accepted: the person now has a portal account. */
export function activate(user: ClientUser, portalAccount: string, name: string): Result<ClientUser, "not-invited"> {
  if (user.status !== "invited") return err("not-invited");
  return ok({ ...user, portalAccount, name: name.trim() || user.name, status: "active" });
}

/** Turns access off or back on. Someone who never accepted their invite goes back to "invited". */
export function setAccess(user: ClientUser, on: boolean): Result<ClientUser, "unchanged"> {
  const to: ClientUserStatus = on ? (user.portalAccount === null ? "invited" : "active") : "disabled";
  return to === user.status ? err("unchanged") : ok({ ...user, status: to });
}

/** Only an active client user of the organization gets a session. */
export function sessionFor(user: ClientUser | null): ClientSession | null {
  return user && user.status === "active" ? { clientUserId: user.id, organizationId: user.organizationId, name: user.name } : null;
}

export type ProjectUpdate = {
  readonly id: Id;
  readonly projectId: Id;
  /** Set when Potomac wrote it. */
  readonly userId: Id | null;
  /** Set when the client wrote it. */
  readonly clientUserId: Id | null;
  readonly body: string;
  readonly createdAt: string;
};

export function newUpdate(ids: { readonly id: Id; readonly projectId: Id; readonly userId: Id | null; readonly clientUserId: Id | null }, body: string, at: string): Result<ProjectUpdate, "message-empty" | "message-too-long"> {
  const text = body.trim();
  if (text === "") return err("message-empty");
  if (text.length > 5000) return err("message-too-long");
  return ok({ ...ids, body: text, createdAt: at });
}

export type CallStatus = "requested" | "confirmed" | "declined";

/** A client asking for a call. Potomac confirms a day and time, or declines with a reply. */
export type CallRequest = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly clientUserId: Id;
  /** When they would like it, in their words. */
  readonly wanted: string;
  readonly note: string;
  /** The number to call, as they typed it. Empty when they gave none. */
  readonly phone: string;
  readonly status: CallStatus;
  readonly confirmedFor: string | null;
  readonly reply: string;
  readonly answeredBy: Id | null;
};

export function newCallRequest(ids: { readonly id: Id; readonly organizationId: Id; readonly clientUserId: Id }, input: { readonly wanted: string; readonly note?: string | null; readonly phone?: string | null }): Result<CallRequest, "wanted-missing" | "wanted-too-long" | "note-too-long" | "phone-invalid"> {
  const wanted = requiredText(input.wanted, 200);
  if (!wanted.ok) return err(wanted.error === "missing" ? "wanted-missing" : "wanted-too-long");
  const note = optionalText(input.note, 1000);
  if (!note.ok) return err("note-too-long");
  // A number as people write one: digits with spaces, dashes, dots, brackets, a plus, or "ext".
  const phone = (input.phone ?? "").trim().replace(/\s+/g, " ");
  if (phone !== "" && (phone.length > 40 || !/^[0-9+().\- extEXT]+$/.test(phone) || phone.replace(/\D/g, "").length < 7)) return err("phone-invalid");
  return ok({ ...ids, wanted: wanted.value, note: note.value ?? "", phone, status: "requested", confirmedFor: null, reply: "", answeredBy: null });
}

export function answerCall(request: CallRequest, input: { readonly answer: string; readonly confirmedFor?: string | null; readonly reply?: string | null }, by: Id): Result<CallRequest, "already-answered" | "invalid-answer" | "when-missing" | "when-too-long" | "reply-too-long"> {
  if (request.status !== "requested") return err("already-answered");
  if (input.answer !== "confirmed" && input.answer !== "declined") return err("invalid-answer");
  const reply = optionalText(input.reply, 1000);
  if (!reply.ok) return err("reply-too-long");
  const when = optionalText(input.confirmedFor, 100);
  if (!when.ok) return err("when-too-long");
  if (input.answer === "confirmed" && when.value === null) return err("when-missing");
  return ok({ ...request, status: input.answer, confirmedFor: input.answer === "confirmed" ? when.value : null, reply: reply.value ?? "", answeredBy: by });
}

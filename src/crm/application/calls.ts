// The call screen (decision 0009, call mode): start a call with someone at a
// client, keep its timer on the server, change its planned length, keep
// notes as they're typed, and end it into the call log with its length.
import { callClock, changeLength, setLength, QUICK_CALL_MINUTES, forgotten, keepNote, loggedMinutes, plannedFromBooking, startCall as newCall, timerText, CALL_STEP_MINUTES, MAX_CALL_MINUTES, MIN_CALL_MINUTES, AUTO_END_MINUTES, type Call, type CallClock, type CallError } from "../domain/call.ts";
import { OUTCOME_LABELS } from "../domain/touch.ts";
import type { Contact } from "../domain/contact.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import { writeTouch, type LogTouchError, type TouchDeps } from "./touches.ts";
import type { CallStore } from "./ports.ts";

export type CallDeps = TouchDeps & { readonly calls: CallStore };
type Refused = "forbidden" | "not-found";
const allowed = (deps: CallDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

/** Where a call is started from. */
export type CallFrom = { readonly clientId: Id } | { readonly contactId: Id } | { readonly opportunityId: Id } | { readonly bookingId: Id };

export type StartError = Refused | "invalid-length" | "booking-not-in-crm" | "booking-cancelled";
/** The call, and whether it was already going: one open call per person. */
export type Started = { readonly call: Call; readonly already: boolean };

/** The contact to call: the one named, else the primary contact with a phone, else anyone with one. */
function whoToCall(deps: CallDeps, organizationId: Id, contactId: Id | null): Contact | null {
  if (contactId) return deps.contacts.get(contactId);
  const all = deps.contacts.listFor(organizationId);
  return all.find((one) => one.isPrimary && one.phone) ?? all.find((one) => one.phone) ?? all.find((one) => one.isPrimary) ?? all[0] ?? null;
}

/**
 * Starts a call and its timer. One open call per person: on one already,
 * it answers with that call, `already` set, instead of starting another. Permission:
 * `contact.edit`, as logging a call needs.
 */
export function startCall(deps: CallDeps, actorId: Id | null, from: CallFrom): Result<Started, StartError> {
  if (!allowed(deps, actorId, "contact.edit")) return err("forbidden");
  endForgottenCalls(deps);
  return deps.transact(() => {
    const open = deps.calls.openFor(actorId);
    if (open) return ok({ call: open, already: true });
    let organizationId: Id;
    let contactId: Id | null = null;
    let opportunityId: Id | null = null;
    let bookingId: Id | null = null;
    let planned: number | undefined;
    let phone = "";
    if ("bookingId" in from) {
      const booking = deps.calls.booking(from.bookingId);
      if (!booking) return err("not-found");
      if (!booking.booked) return err("booking-cancelled");
      if (!booking.organizationId) return err("booking-not-in-crm");
      organizationId = booking.organizationId;
      bookingId = booking.id;
      planned = plannedFromBooking(booking.startsAt, booking.endsAt);
      phone = booking.phone;
    } else if ("opportunityId" in from) {
      const opportunity = deps.opportunities.get(from.opportunityId);
      if (!opportunity) return err("not-found");
      organizationId = opportunity.organizationId;
      opportunityId = opportunity.id;
      contactId = opportunity.contactId;
    } else if ("contactId" in from) {
      const contact = deps.contacts.get(from.contactId);
      if (!contact) return err("not-found");
      organizationId = contact.organizationId;
      contactId = contact.id;
    } else {
      organizationId = from.clientId;
    }
    if (!deps.clients.get(organizationId)) return err("not-found");
    const contact = whoToCall(deps, organizationId, contactId);
    if (contact && contact.organizationId === organizationId) {
      contactId = contact.id;
      phone = contact.phone || phone;
    }
    // No number for the person: the business's own, if it has one.
    phone = phone || deps.clients.get(organizationId)?.phone || "";
    const made = newCall({ id: deps.newId(), organizationId, contactId, opportunityId, bookingId, userId: actorId, phone, startedAt: deps.clock() }, planned);
    if (!made.ok) return made;
    deps.calls.insert(made.value, deps.clock());
    recordActivity(deps, { actorId, action: "call.started", recordType: "call", recordId: made.value.id, context: { clientId: organizationId, plannedMinutes: made.value.plannedMinutes, ...(bookingId ? { bookingId } : {}) } });
    return ok({ call: made.value, already: false });
  });
}

/** The caller's own open call, checked. Nobody else can change it. */
function ownOpenCall(deps: CallDeps, actorId: Id | null, callId: Id): Result<Call, Refused | "call-ended"> {
  if (!allowed(deps, actorId, "contact.edit")) return err("forbidden");
  const call = deps.calls.get(callId);
  if (!call || call.userId !== actorId) return err("not-found");
  if (call.endedAt !== null) return err("call-ended");
  return ok(call);
}

/** Longer or shorter by `steps` of 5 minutes, or set to exactly `{ minutes }`. */
export function changeCallLength(deps: CallDeps, actorId: Id | null, callId: Id, change: number | { readonly minutes: number }): Result<Call, Refused | CallError> {
  return deps.transact(() => {
    const call = ownOpenCall(deps, actorId, callId);
    if (!call.ok) return call;
    const changed = typeof change === "number" ? changeLength(call.value, change) : setLength(call.value, change.minutes);
    if (!changed.ok) return changed;
    if (changed.value.plannedMinutes === call.value.plannedMinutes) return ok(call.value);
    deps.calls.update(changed.value);
    recordActivity(deps, { actorId, action: "call.length-changed", recordType: "call", recordId: callId, context: { from: call.value.plannedMinutes, to: changed.value.plannedMinutes } });
    return ok(changed.value);
  });
}

/** Keeps the notes typed so far. Saved as they're typed, so no event for each keystroke. */
export function keepCallNote(deps: CallDeps, actorId: Id | null, callId: Id, note: string): Result<Call, Refused | CallError> {
  return deps.transact(() => {
    const call = ownOpenCall(deps, actorId, callId);
    if (!call.ok) return call;
    const kept = keepNote(call.value, note);
    if (!kept.ok) return kept;
    deps.calls.update(kept.value);
    return ok(kept.value);
  });
}

export type EndCallInput = { readonly outcome?: string | null; readonly note?: string | null; readonly followUpOn?: string | null };

/**
 * Ends the call and logs it, with its length, at the client or on its
 * opportunity, setting the follow-up if one is given: one transaction.
 */
export function endCall(deps: CallDeps, actorId: Id | null, callId: Id, input: EndCallInput): Result<Call, Refused | "call-ended" | LogTouchError> {
  return deps.transact(() => {
    const found = ownOpenCall(deps, actorId, callId);
    if (!found.ok) return found;
    const call = found.value;
    const endedAt = deps.clock();
    const minutes = loggedMinutes(call.startedAt, endedAt);
    const where = call.opportunityId ? { opportunityId: call.opportunityId } : { clientId: call.organizationId };
    const logged = writeTouch(deps, actorId, where, { kind: "call", outcome: input.outcome ?? "reached", note: input.note ?? call.note, contactId: call.contactId, followUpOn: input.followUpOn ?? null }, { minutes, callId });
    if (!logged.ok) return logged;
    deps.calls.end(callId, endedAt, logged.value.id);
    recordActivity(deps, { actorId, action: "call.ended", recordType: "call", recordId: callId, context: { clientId: call.organizationId, minutes, outcome: logged.value.outcome ?? "reached" } });
    return ok({ ...call, endedAt, touchId: logged.value.id });
  });
}

/**
 * Ends calls nobody ended within 3 hours, logging each as a talk with a note
 * that says so. Run when a call starts and by the morning job; returns how many.
 */
export function endForgottenCalls(deps: CallDeps): number {
  const cutoff = new Date(Date.parse(deps.clock()) - AUTO_END_MINUTES * 60_000).toISOString();
  let ended = 0;
  for (const call of deps.calls.openStartedBy(cutoff)) {
    if (!forgotten(call, deps.clock())) continue;
    deps.transact(() => {
      const endedAt = new Date(Date.parse(call.startedAt) + AUTO_END_MINUTES * 60_000).toISOString();
      const minutes = loggedMinutes(call.startedAt, endedAt);
      const note = `${call.note ? `${call.note}\n\n` : ""}Ended by HQ after ${AUTO_END_MINUTES / 60} hours, because nobody ended it. The length is a guess.`.slice(0, 2000);
      const where = call.opportunityId ? { opportunityId: call.opportunityId } : { clientId: call.organizationId };
      const logged = writeTouch(deps, call.userId, where, { kind: "call", outcome: "reached", note, contactId: call.contactId }, { minutes, callId: call.id });
      deps.calls.end(call.id, endedAt, logged.ok ? logged.value.id : null);
      recordActivity(deps, { actorId: null, action: "call.ended-automatically", recordType: "call", recordId: call.id, context: { clientId: call.organizationId, userId: call.userId, minutes } });
    });
    ended += 1;
  }
  return ended;
}

export type CallScreen = {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly contactName: string;
  readonly phone: string;
  /** "tel:+13045550100", or "" with no number. */
  readonly dial: string;
  readonly opportunityId: string;
  readonly opportunityTitle: string;
  readonly topic: string;
  readonly startedAt: string;
  readonly startedText: string;
  readonly plannedMinutes: number;
  readonly warnMinutes: number;
  readonly endsText: string;
  readonly wrapUpText: string;
  readonly clock: CallClock;
  /** The server's time as it made the page, so the timer can allow for the device's clock being off. */
  readonly now: string;
  /** The timer as the server last saw it, for a page without scripts. */
  readonly timer: string;
  readonly note: string;
  readonly canLonger: boolean;
  readonly canShorter: boolean;
  /** One-tap lengths: 15, 30, 45 and 60 minutes, the current one marked. */
  readonly lengths: readonly { readonly minutes: number; readonly label: string; readonly current: boolean }[];
  readonly canFollowUp: boolean;
  readonly outcomes: readonly { readonly value: string; readonly label: string }[];
  readonly ended: boolean;
  readonly endedText: string;
};

/** A phone number as a `tel:` address: digits and a leading plus only. A US number without a country code gets +1. */
export function dialAddress(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (digits.replace("+", "").length < 7) return "";
  if (digits.startsWith("+")) return `tel:${digits}`;
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${digits}`;
}

/** "3:10 PM": a time later in the call, as a clock reads. */
const clockTime = (instant: string, zone: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });

/** The call screen. Only the person on the call sees it. */
export function callScreen(deps: CallDeps, actorId: Id | null, callId: Id): Result<CallScreen, Refused> {
  if (!allowed(deps, actorId, "contact.edit")) return err("forbidden");
  const call = deps.calls.get(callId);
  if (!call || call.userId !== actorId) return err("not-found");
  const client = deps.clients.get(call.organizationId);
  if (!client) return err("not-found");
  const contact = call.contactId ? deps.contacts.get(call.contactId) : null;
  const opportunity = call.opportunityId ? deps.opportunities.get(call.opportunityId) : null;
  const booking = call.bookingId ? deps.calls.booking(call.bookingId) : null;
  const clock = callClock(call, deps.clock());
  return ok({
    id: call.id,
    clientId: client.id,
    clientName: client.name,
    contactName: contact?.name ?? booking?.name ?? "",
    phone: call.phone,
    dial: dialAddress(call.phone),
    opportunityId: opportunity?.id ?? "",
    opportunityTitle: opportunity?.title ?? "",
    topic: booking?.topic ?? "",
    startedAt: call.startedAt,
    startedText: deps.formatWhen(call.startedAt),
    plannedMinutes: call.plannedMinutes,
    warnMinutes: call.warnMinutes,
    endsText: clockTime(clock.endsAt, deps.timeZone),
    wrapUpText: clockTime(clock.wrapUpAt, deps.timeZone),
    clock,
    now: deps.clock(),
    timer: timerText(clock.elapsed),
    note: call.note,
    canLonger: call.plannedMinutes + CALL_STEP_MINUTES <= MAX_CALL_MINUTES,
    canShorter: call.plannedMinutes - CALL_STEP_MINUTES >= MIN_CALL_MINUTES,
    lengths: QUICK_CALL_MINUTES.map((minutes) => ({ minutes, label: minutes === 60 ? "1 h" : `${minutes} min`, current: minutes === call.plannedMinutes })),
    canFollowUp: opportunity !== null && allowed(deps, actorId, "opportunity.set-follow-up"),
    outcomes: Object.entries(OUTCOME_LABELS).map(([value, label]) => ({ value, label })),
    ended: call.endedAt !== null,
    endedText: call.endedAt ? deps.formatWhen(call.endedAt) : "",
  });
}

/** The person's open call, for the shell's "On a call" link; null when not on one. */
export function openCall(deps: CallDeps, actorId: Id | null): { readonly id: string; readonly clientName: string; readonly startedAt: string } | null {
  if (actorId === null) return null;
  const call = deps.calls.openFor(actorId);
  if (!call) return null;
  return { id: call.id, clientName: deps.clients.get(call.organizationId)?.name ?? "", startedAt: call.startedAt };
}

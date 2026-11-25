// The call screen (decision 0009, call mode): start a call with someone at a
// client, keep its timer on the server, change its planned length, keep
// notes as they're typed, and end it into the call log with its length.
import { addBusinessDays, draftRecap, fillScript, readRecap, readReturnTo, startsText, type RecapError, GET_READY_MINUTES, OVERDUE_CALL_DAYS, RETRY_BUSINESS_DAYS, callClock, changeLength, setLength, QUICK_CALL_MINUTES, forgotten, keepNote, loggedMinutes, plannedFromBooking, startCall as newCall, timerText, CALL_STEP_MINUTES, MAX_CALL_MINUTES, MIN_CALL_MINUTES, AUTO_END_MINUTES, type Call, type CallClock, type CallError } from "../domain/call.ts";
import { OUTCOME_LABELS } from "../domain/touch.ts";
import { callSummary, isSituation, MAX_ANSWER_LENGTH, pickSituation, readGuide, SITUATION_HINTS, type GuideError, type Situation } from "../domain/call-guide.ts";
import type { Contact } from "../domain/contact.ts";
import { authorize } from "../../identity/index.ts";
import { err, formatHours, formatMoney, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import { goingCold, writeTouch, type LogTouchError, type TouchDeps } from "./touches.ts";
import type { CallGuideStore, CallStore, ClientFacts, ClientFactsReader } from "./ports.ts";

/** "17 min", for the routes' messages. */
export { lengthText } from "../domain/call.ts";

export type CallDeps = TouchDeps & { readonly calls: CallStore; readonly guides: CallGuideStore; readonly facts: ClientFactsReader; readonly followThrough?: FollowThrough };

/**
 * What ending a call can do in other parts of HQ (decision 0009, section 4):
 * a to-do for each next step, and the call's time on a project. Their own
 * services, wired where services are put together, each with its own checks
 * and activity, so the CRM doesn't depend on them.
 */
export type FollowThrough = {
  addTodo(actorId: Id, input: { readonly title: string; readonly clientId: Id; readonly opportunityId: Id | null; readonly dueOn?: string | null }): Result<unknown, string>;
  logTime(actorId: Id, projectId: Id, input: { readonly on: string; readonly hours: string; readonly note: string; readonly billable: boolean }): Result<unknown, string>;
};
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
export function startCall(deps: CallDeps, actorId: Id | null, from: CallFrom, options: { readonly returnTo?: string | null } = {}): Result<Started, StartError> {
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
    const facts = deps.facts.facts(organizationId, deps.today());
    const guide = pickSituation({ hasProposalOrProject: facts.anyProposalOrProject, proposalWaiting: facts.proposalsWaiting.length > 0, activeProject: facts.activeProjects.length > 0, renewalSoon: facts.renewalsSoon.length > 0 });
    const made = newCall({ id: deps.newId(), organizationId, contactId, opportunityId, bookingId, userId: actorId, phone, startedAt: deps.clock() }, planned, guide);
    if (!made.ok) return made;
    const call = { ...made.value, returnTo: readReturnTo(options.returnTo) };
    deps.calls.insert(call, deps.clock());
    recordActivity(deps, { actorId, action: "call.started", recordType: "call", recordId: made.value.id, context: { clientId: organizationId, plannedMinutes: made.value.plannedMinutes, guide, ...(bookingId ? { bookingId } : {}) } });
    return ok({ call, already: false });
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
    const note = callSummary(input.note ?? call.note, deps.guides.answers(callId));
    const outcome = input.outcome ?? "reached";
    // Nobody answered: try again in two business days, on an open opportunity, unless a day was chosen.
    const retry = (outcome === "voicemail" || outcome === "no-answer") && !(input.followUpOn ?? "").trim() && call.opportunityId !== null && deps.opportunities.get(call.opportunityId)?.stage !== "won" && deps.opportunities.get(call.opportunityId)?.stage !== "lost" && allowed(deps, actorId, "opportunity.set-follow-up");
    const followUpOn = retry ? addBusinessDays(deps.today(), RETRY_BUSINESS_DAYS) : (input.followUpOn ?? null);
    const logged = writeTouch(deps, actorId, where, { kind: "call", outcome, note, contactId: call.contactId, followUpOn }, { minutes, callId });
    if (!logged.ok) return logged;
    // The notes as typed, without the guide's answers, are what a recap email starts from.
    deps.calls.update({ ...call, note: (input.note ?? call.note).trim().slice(0, 2000) });
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
      const note = callSummary(`${call.note ? `${call.note}\n\n` : ""}Ended by HQ after ${AUTO_END_MINUTES / 60} hours, because nobody ended it. The length is a guess.`, deps.guides.answers(call.id));
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
  /** What HQ's records say worth raising, the ones this person may see. */
  readonly points: readonly TalkingPoint[];
  /** Projects the call's time can go to, when the person may log time; `hourly` ones are ticked to start with. */
  readonly projects: readonly { readonly id: string; readonly name: string; readonly hourly: boolean }[];
  /** Whether next steps can become to-dos. */
  readonly canAddTodos: boolean;
  /** The voicemail script, filled in for this call. */
  readonly voicemail: string;
  /** Started from the calls to make: ending goes back there. */
  readonly fromList: boolean;
  /** Who a recap email would go to, or "" when the contact has no email. */
  readonly recapTo: string;
  readonly guide: GuideOnCall;
  /** The other guides, to switch to. */
  readonly guides: readonly { readonly value: string; readonly label: string }[];
};

export type TalkingPoint = { readonly kind: "waiting-on-us" | "waiting-on-them" | "money" | "site" | "renewal" | "last-call"; readonly text: string };
export type GuideOnCall = {
  readonly situation: string;
  readonly title: string;
  readonly hint: string;
  readonly questions: readonly { readonly position: number; readonly text: string; readonly asked: boolean; readonly answer: string }[];
  /** Questions neither ticked nor answered yet. */
  readonly left: number;
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
  const facts = deps.facts.facts(call.organizationId, deps.today(), call.id);
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
    points: talkingPoints(deps, actorId, facts),
    projects: deps.followThrough && allowed(deps, actorId, "time.log") ? facts.activeProjects.map((one) => ({ id: one.id, name: one.name, hourly: one.hourly })) : [],
    canAddTodos: Boolean(deps.followThrough) && allowed(deps, actorId, "task.edit"),
    voicemail: fillScript(deps.guides.script("voicemail")?.text ?? "", { name: contact?.name ?? booking?.name ?? "", me: deps.users.get(call.userId)?.name ?? "", about: opportunity?.title ?? facts.activeProjects[0]?.name ?? "" }),
    fromList: call.returnTo !== null,
    recapTo: contact?.email ? contact.name : "",
    guide: guideOnCall(deps, call),
    guides: deps.guides.all().map((one) => ({ value: one.situation, label: one.title })),
  });
}

/** The guide on the call: its questions as they are now, with the call's answers; a question already answered keeps the words it was asked in. */
function guideOnCall(deps: CallDeps, call: Call): GuideOnCall {
  const situation = call.guide && isSituation(call.guide) ? call.guide : "any";
  const guide = deps.guides.get(situation);
  const answers = new Map(deps.guides.answers(call.id).filter((one) => one.guide === situation).map((one) => [one.position, one]));
  const questions = (guide?.questions ?? []).map((text, index) => {
    const answer = answers.get(index + 1);
    return { position: index + 1, text: answer?.question ?? text, asked: answer?.asked ?? false, answer: answer?.answer ?? "" };
  });
  return { situation, title: guide?.title ?? "Any call", hint: SITUATION_HINTS[situation], questions, left: questions.filter((one) => !one.asked && !one.answer.trim()).length };
}

const days = (from: string, to: string) => Math.max(0, Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to)).days);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const amount = (minor: number, currency: string) => formatMoney({ minor, currency } as never);

/**
 * Talking points from a client's facts, each only for those who may see what
 * it comes from: money needs invoice.view (or opportunity.view-value for a
 * proposal's total), projects project.view, sites and renewals client.view.
 */
export function talkingPoints(deps: CallDeps, actorId: Id, facts: ClientFacts): TalkingPoint[] {
  const may = (action: string) => allowed(deps, actorId, action);
  const today = deps.today();
  const dayOf = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(deps.timeZone).toPlainDate().toString();
  const ago = (instant: string) => {
    const n = days(dayOf(instant), today);
    return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
  };
  const points: TalkingPoint[] = [];
  if (may("project.view")) {
    for (const one of facts.messagesUnanswered) points.push({ kind: "waiting-on-us", text: `They wrote about ${one.projectName} ${ago(one.at)}, and haven't had an answer.` });
    for (const one of facts.changesAsked) points.push({ kind: "waiting-on-us", text: `They asked for changes to “${one.title}” (${one.projectName}).` });
  }
  if (may("client.view")) for (const one of facts.callsAsked) points.push({ kind: "waiting-on-us", text: `They asked for a call ${ago(one.at)}: ${one.wanted}.` });
  if (may("project.view")) {
    for (const one of facts.approvalsWaiting) points.push({ kind: "waiting-on-them", text: `Waiting on them to approve “${one.title}” (${one.projectName}).` });
    for (const one of facts.changeRequestsWaiting) points.push({ kind: "waiting-on-them", text: `Waiting on their answer to change request ${one.number}, “${one.title}”${may("invoice.view") ? `, ${amount(one.amountMinor, one.currency)}` : ""}.` });
  }
  if (may("proposal.view")) for (const one of facts.proposalsWaiting) points.push({ kind: "waiting-on-them", text: `The proposal “${one.title}” was sent ${ago(one.sentAt)}${may("opportunity.view-value") ? `, ${amount(one.totalMinor, one.currency)}` : ""}, and isn't answered yet.` });
  if (may("invoice.view")) for (const one of facts.overdueInvoices) points.push({ kind: "money", text: `INV-${String(one.number).padStart(4, "0")} is ${plural(days(one.dueOn, today), "day")} late: ${amount(one.totalMinor, one.currency)}.` });
  if (may("client.view")) {
    for (const one of facts.sitesDown) points.push({ kind: "site", text: `Their site ${one.url} is down${one.since ? `, since ${deps.formatWhen(one.since)}` : ""}.` });
    for (const one of facts.certificatesEnding) points.push({ kind: "site", text: one.on < today ? `The certificate for ${one.url} has ended.` : `The certificate for ${one.url} ends on ${one.on}.` });
    for (const one of facts.renewalsSoon) points.push({ kind: "renewal", text: `${one.name} renews ${one.on === today ? "today" : `in ${plural(days(today, one.on), "day")}`}.` });
    if (facts.lastCall) points.push({ kind: "last-call", text: `Last call, ${deps.formatWhen(facts.lastCall.at)}: ${facts.lastCall.note.length > 240 ? `${facts.lastCall.note.slice(0, 239)}…` : facts.lastCall.note}` });
  }
  return points;
}

export type AnswerInput = { readonly asked: ReadonlySet<number>; readonly answers: ReadonlyMap<number, string> };

/**
 * Saves the guide's answers as they stand: each question ticked as asked,
 * and what was said. Saved as they're typed; `call.answered` is written the
 * first time each question is ticked.
 */
export function saveAnswers(deps: CallDeps, actorId: Id | null, callId: Id, input: AnswerInput): Result<Call, Refused | "call-ended" | "answer-too-long"> {
  return deps.transact(() => {
    const found = ownOpenCall(deps, actorId, callId);
    if (!found.ok) return found;
    const call = found.value;
    for (const answer of input.answers.values()) if (answer.length > MAX_ANSWER_LENGTH) return err("answer-too-long");
    const screen = guideOnCall(deps, call);
    for (const question of screen.questions) {
      const asked = input.asked.has(question.position);
      const answer = (input.answers.get(question.position) ?? "").trim();
      if (asked === question.asked && answer === question.answer) continue;
      deps.guides.saveAnswer(callId, { guide: screen.situation, position: question.position, question: question.text, asked, answer });
      if (asked && !question.asked) recordActivity(deps, { actorId: actorId as Id, action: "call.answered", recordType: "call", recordId: callId, context: { guide: screen.situation, position: question.position } });
    }
    return ok(call);
  });
}

/** Switches the call to another guide. Answers to the first are kept, and are in its summary. */
export function switchGuide(deps: CallDeps, actorId: Id | null, callId: Id, situation: string): Result<Call, Refused | "call-ended" | "invalid-guide"> {
  return deps.transact(() => {
    const found = ownOpenCall(deps, actorId, callId);
    if (!found.ok) return found;
    if (!isSituation(situation)) return err("invalid-guide");
    if (found.value.guide === situation) return ok(found.value);
    const changed = { ...found.value, guide: situation };
    deps.calls.update(changed);
    recordActivity(deps, { actorId: actorId as Id, action: "call.guide-changed", recordType: "call", recordId: callId, context: { from: found.value.guide ?? "", to: situation } });
    return ok(changed);
  });
}

export type GuidesView = {
  readonly canEdit: boolean;
  readonly guides: readonly { readonly situation: string; readonly title: string; readonly hint: string; readonly questions: string; readonly count: number; readonly updated: string }[];
};

/** The call guides, to read (knowledge.view) and change (knowledge.edit). */
export function callGuides(deps: CallDeps, actorId: Id | null): Result<GuidesView, "forbidden"> {
  if (!allowed(deps, actorId, "knowledge.view")) return err("forbidden");
  return ok({
    canEdit: allowed(deps, actorId, "knowledge.edit"),
    guides: deps.guides.all().map((one) => ({
      situation: one.situation,
      title: one.title,
      hint: isSituation(one.situation) ? SITUATION_HINTS[one.situation] : "",
      questions: one.questions.join("\n"),
      count: one.questions.length,
      updated: one.updatedBy ? `Changed by ${deps.users.get(one.updatedBy)?.name ?? "someone"}, ${deps.formatWhen(one.updatedAt)}` : "As HQ came",
    })),
  });
}

/** Changes a guide. Calls already made keep the questions they were asked. Permission: `knowledge.edit`. */
export function saveCallGuide(deps: CallDeps, actorId: Id | null, situation: string, input: { readonly title: string; readonly questions: string }): Result<{ readonly situation: Situation; readonly count: number }, Refused | GuideError> {
  if (!allowed(deps, actorId, "knowledge.edit")) return err("forbidden");
  if (!isSituation(situation)) return err("not-found");
  const read = readGuide(input);
  if (!read.ok) return read;
  return deps.transact(() => {
    if (!deps.guides.get(situation)) return err("not-found");
    deps.guides.save(situation, read.value.title, read.value.questions, deps.clock(), actorId);
    recordActivity(deps, { actorId, action: "call-guide.changed", recordType: "call-guide", recordId: deps.newId(), context: { situation, title: read.value.title, questions: read.value.questions.length } });
    return ok({ situation, count: read.value.questions.length });
  });
}

/** The person's open call, for the shell's "On a call" link; null when not on one. */
export function openCall(deps: CallDeps, actorId: Id | null): { readonly id: string; readonly clientName: string; readonly startedAt: string } | null {
  if (actorId === null) return null;
  const call = deps.calls.openFor(actorId);
  if (!call) return null;
  return { id: call.id, clientName: deps.clients.get(call.organizationId)?.name ?? "", startedAt: call.startedAt };
}

/** Who is on a call, for booking the next one from its screen (decision 0009, section 3). Only the person on the call, while it's open. */
export type CallParty = { readonly callId: Id; readonly organizationId: Id; readonly clientName: string; readonly contactName: string; readonly email: string; readonly phone: string; readonly opportunityId: Id | null };

export function callParty(deps: CallDeps, actorId: Id | null, callId: Id): Result<CallParty, Refused | "call-ended"> {
  const found = ownOpenCall(deps, actorId, callId);
  if (!found.ok) return found;
  const call = found.value;
  const client = deps.clients.get(call.organizationId);
  if (!client) return err("not-found");
  const contact = call.contactId ? deps.contacts.get(call.contactId) : null;
  return ok({ callId, organizationId: client.id, clientName: client.name, contactName: contact?.name ?? client.name, email: contact?.email ?? "", phone: call.phone, opportunityId: call.opportunityId });
}

export type FollowedThrough = { readonly todos: number; readonly loggedMinutes: number; readonly problems: readonly string[] };

/**
 * After a call is ended: a to-do at the client (and its opportunity) for each
 * next step, one a line, and the call's time on a project if one was ticked.
 * Each goes through its own service, so each is checked as if done by hand;
 * one that's refused is reported and the rest still happen.
 */
export function followThroughCall(deps: CallDeps, actorId: Id | null, callId: Id, input: { readonly nextSteps?: string | null; readonly projectId?: string | null }): Result<FollowedThrough, Refused | "call-open"> {
  if (!allowed(deps, actorId, "contact.edit")) return err("forbidden");
  const call = deps.calls.get(callId);
  if (!call || call.userId !== actorId) return err("not-found");
  if (call.endedAt === null) return err("call-open");
  const steps = (input.nextSteps ?? "").split(/\r?\n/).map((line) => line.trim().replace(/^[-*•]\s*/, "")).filter(Boolean).slice(0, 10);
  const problems: string[] = [];
  let todos = 0;
  let timeLogged = 0;
  // Nobody answered and there's no opportunity to follow up on: a to-do to try again, in two business days.
  const touch = call.touchId ? deps.touches.listForClient(call.organizationId, 20).find((one) => one.id === call.touchId) : null;
  const tryAgain = deps.followThrough && call.opportunityId === null && (touch?.outcome === "voicemail" || touch?.outcome === "no-answer");
  if (tryAgain && deps.followThrough) {
    const contact = call.contactId ? deps.contacts.get(call.contactId) : null;
    const name = contact?.name ?? deps.clients.get(call.organizationId)?.name ?? "them";
    const added = deps.followThrough.addTodo(actorId, { title: `Call ${name} again`, clientId: call.organizationId, opportunityId: null, dueOn: addBusinessDays(deps.today(), RETRY_BUSINESS_DAYS) });
    if (added.ok) todos += 1;
    else problems.push("the to-do to call again wasn't added");
  }
  if (deps.followThrough) {
    for (const title of steps) {
      const added = deps.followThrough.addTodo(actorId, { title: title.slice(0, 200), clientId: call.organizationId, opportunityId: call.opportunityId });
      if (added.ok) todos += 1;
      else problems.push(`“${title.slice(0, 40)}” didn't become a to-do`);
    }
    const projectId = (input.projectId ?? "").trim();
    if (projectId) {
      const minutes = loggedMinutes(call.startedAt, call.endedAt);
      const project = deps.facts.facts(call.organizationId, deps.today(), call.id).activeProjects.find((one) => one.id === projectId);
      const client = deps.clients.get(call.organizationId);
      const logged = project
        ? deps.followThrough.logTime(actorId, project.id, { on: deps.today(), hours: formatHours(minutes), note: `Call with ${client?.name ?? "the client"}`, billable: project.hourly })
        : { ok: false as const, error: "not-found" };
      if (logged.ok) timeLogged = minutes;
      else problems.push("the call's time wasn't logged");
    }
  } else if (steps.length > 0 || input.projectId) problems.push("to-dos and time aren't set up here");
  return ok({ todos, loggedMinutes: timeLogged, problems });
}

export type CallToMake = {
  readonly key: string;
  readonly clientName: string;
  /** What to start the call from: the opportunity when there is one, else the client. */
  readonly field: "opportunityId" | "clientId";
  readonly id: string;
  /** Why to call, most pressing first. */
  readonly reasons: readonly string[];
  readonly urgent: boolean;
};

export type CallsToMakeView = { readonly items: readonly CallToMake[]; readonly calledToday: number; readonly canCall: boolean };

/**
 * Today's calls to make (decision 0009, section 5): calls asked for in the
 * portal, follow-ups due (overdue first), invoices a week or more late, and
 * opportunities going cold. One line per client, with every reason, each
 * only for those who may see it. A client called today drops off.
 */
export function callsToMake(deps: CallDeps, actorId: Id | null): CallsToMakeView {
  if (actorId === null || !allowed(deps, actorId, "client.view")) return { items: [], calledToday: 0, canCall: false };
  const today = deps.today();
  const since = Temporal.PlainDate.from(today).toZonedDateTime({ timeZone: deps.timeZone }).toInstant().toString();
  const list = deps.facts.callList(today, OVERDUE_CALL_DAYS, since);
  type Entry = { clientName: string; field: "opportunityId" | "clientId"; id: string; reasons: { rank: number; text: string }[] };
  const byClient = new Map<string, Entry>();
  const add = (organizationId: string, clientName: string, rank: number, text: string, opportunityId: string | null) => {
    const entry = byClient.get(organizationId) ?? { clientName, field: "clientId" as const, id: organizationId, reasons: [] };
    if (opportunityId && entry.field === "clientId") Object.assign(entry, { field: "opportunityId", id: opportunityId });
    entry.reasons.push({ rank, text });
    byClient.set(organizationId, entry);
  };
  for (const one of list.callRequests) add(one.organizationId, one.clientName, 0, `They asked for a call: ${one.wanted}`, null);
  if (allowed(deps, actorId, "opportunity.view")) {
    for (const one of deps.opportunities.dueBy(today)) {
      const late = days(one.followUpOn ?? today, today);
      add(one.organizationId, one.clientName, late > 0 ? 1 : 2, late > 0 ? `Follow-up on “${one.title}”, ${plural(late, "day")} overdue` : `Follow-up on “${one.title}” is today`, one.id);
    }
  }
  if (allowed(deps, actorId, "invoice.view")) for (const one of list.overdueInvoices) add(one.organizationId, one.clientName, 3, `INV-${String(one.number).padStart(4, "0")} is ${plural(days(one.dueOn, today), "day")} late: ${amount(one.totalMinor, one.currency)}`, null);
  for (const one of goingCold(deps, actorId)) add(one.organizationId, one.clientName, 4, `“${one.title}” is going cold: ${one.lastText.toLowerCase()}`, one.id);
  const entries = [...byClient.entries()];
  const calledToday = list.calledSince.size;
  const items = entries
    .filter(([organizationId]) => !list.calledSince.has(organizationId as Id))
    .map(([organizationId, entry]) => {
      const reasons = [...entry.reasons].sort((a, b) => a.rank - b.rank);
      return { key: organizationId, clientName: entry.clientName, field: entry.field, id: entry.id, reasons: reasons.map((one) => one.text), urgent: (reasons[0]?.rank ?? 9) <= 1, rank: reasons[0]?.rank ?? 9 };
    })
    .sort((a, b) => a.rank - b.rank || a.clientName.localeCompare(b.clientName))
    .map(({ rank: _rank, ...item }) => item);
  return { items, calledToday, canCall: allowed(deps, actorId, "contact.edit") };
}

export type ScriptView = { readonly text: string; readonly updated: string; readonly canEdit: boolean };

/** The voicemail script as written, with its blanks. Permission: `knowledge.view`. */
export function voicemailScript(deps: CallDeps, actorId: Id | null): Result<ScriptView, "forbidden"> {
  if (!allowed(deps, actorId, "knowledge.view")) return err("forbidden");
  const script = deps.guides.script("voicemail");
  return ok({ text: script?.text ?? "", updated: script?.updatedBy ? `Changed by ${deps.users.get(script.updatedBy)?.name ?? "someone"}, ${deps.formatWhen(script.updatedAt)}` : "As HQ came", canEdit: allowed(deps, actorId, "knowledge.edit") });
}

/** Changes the voicemail script. Permission: `knowledge.edit`. */
export function saveVoicemailScript(deps: CallDeps, actorId: Id | null, text: string): Result<true, Refused | "script-missing" | "script-too-long"> {
  if (!allowed(deps, actorId, "knowledge.edit")) return err("forbidden");
  const cleaned = text.trim();
  if (!cleaned) return err("script-missing");
  if (cleaned.length > 600) return err("script-too-long");
  return deps.transact(() => {
    deps.guides.saveScript("voicemail", cleaned, deps.clock(), actorId);
    recordActivity(deps, { actorId, action: "call-script.changed", recordType: "call-script", recordId: deps.newId(), context: { kind: "voicemail" } });
    return ok(true as const);
  });
}

/** A booked call about to start, for the top bar and Today (decision 0009, section 6). */
export type ComingUp = { readonly bookingId: string; readonly who: string; readonly when: string; readonly startsText: string; readonly href: string };

/**
 * The next call booked with this person that starts within 15 minutes, or
 * started and hasn't been called yet (until its booked end). Null when on a
 * call already, or with nothing coming up.
 */
export function comingUp(deps: CallDeps, actorId: Id | null): ComingUp | null {
  if (actorId === null || !allowed(deps, actorId, "contact.edit") || deps.calls.openFor(actorId)) return null;
  const now = deps.clock();
  const from = new Date(Date.parse(now) - MAX_CALL_MINUTES * 60_000).toISOString();
  const to = new Date(Date.parse(now) + GET_READY_MINUTES * 60_000).toISOString();
  const next = deps.calls.bookedBetween(actorId, from, to).find((one) => one.endsAt > now && !deps.calls.forBooking(one.id));
  if (!next) return null;
  const clientName = next.organizationId ? (deps.clients.get(next.organizationId)?.name ?? "") : "";
  return { bookingId: next.id, who: clientName && clientName !== next.name ? `${next.name} (${clientName})` : next.name, when: clockTime(next.startsAt, deps.timeZone), startsText: startsText(next.startsAt, now), href: `/get-ready/${next.id}` };
}

export type GetReadyView = {
  readonly bookingId: string;
  readonly name: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly when: string;
  readonly startsText: string;
  readonly minutes: number;
  readonly topic: string;
  readonly phone: string;
  readonly dial: string;
  readonly points: readonly TalkingPoint[];
  readonly guide: { readonly title: string; readonly hint: string; readonly questions: readonly string[] };
  /** In the CRM, so the call can be started and logged. */
  readonly inCrm: boolean;
  readonly canStart: boolean;
  /** The call already started for it, if any. */
  readonly callHref: string;
};

/**
 * Getting ready for a booked call: who, when, why they booked, what's worth
 * raising, and the guide HQ would start with. Needs `contact.edit`, as
 * starting the call does.
 */
export function getReady(deps: CallDeps, actorId: Id | null, bookingId: Id): Result<GetReadyView, Refused> {
  if (!allowed(deps, actorId, "contact.edit")) return err("forbidden");
  const booking = deps.calls.booking(bookingId);
  if (!booking || !booking.booked) return err("not-found");
  const client = booking.organizationId ? deps.clients.get(booking.organizationId) : null;
  const facts = client ? deps.facts.facts(client.id, deps.today()) : null;
  const situation = facts ? pickSituation({ hasProposalOrProject: facts.anyProposalOrProject, proposalWaiting: facts.proposalsWaiting.length > 0, activeProject: facts.activeProjects.length > 0, renewalSoon: facts.renewalsSoon.length > 0 }) : "first-call";
  const guide = deps.guides.get(situation);
  const started = deps.calls.forBooking(bookingId);
  return ok({
    bookingId,
    name: booking.name,
    clientId: client?.id ?? "",
    clientName: client?.name ?? "",
    when: `${Temporal.Instant.from(booking.startsAt).toZonedDateTimeISO(deps.timeZone).toPlainDate().toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" })} at ${clockTime(booking.startsAt, deps.timeZone)}`,
    startsText: startsText(booking.startsAt, deps.clock()),
    minutes: plannedFromBooking(booking.startsAt, booking.endsAt),
    topic: booking.topic,
    phone: booking.phone,
    dial: dialAddress(booking.phone),
    points: facts ? talkingPoints(deps, actorId, facts) : [],
    guide: { title: guide?.title ?? "", hint: SITUATION_HINTS[situation], questions: guide?.questions ?? [] },
    inCrm: client !== null,
    canStart: client !== null && started === null,
    callHref: started && started.userId === actorId ? `/phone/${started.id}` : "",
  });
}

export type RecapView = {
  readonly callId: string;
  readonly clientId: string;
  readonly clientName: string;
  /** Who it goes to: the contact on the call. */
  readonly toName: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /** Sent already: when. */
  readonly sentText: string;
  /** Where "Skip" goes: the list the call came from, or the client's call log. */
  readonly skipTo: string;
};

/**
 * The recap email for an ended call (decision 0009, section 7): drafted from
 * the notes, to the contact on the call. Only the person who made the call;
 * only once it's ended; only to a contact with an email.
 */
export function recapFor(deps: CallDeps, actorId: Id | null, callId: Id): Result<RecapView, Refused | "call-open" | "no-email"> {
  if (!allowed(deps, actorId, "contact.edit")) return err("forbidden");
  const call = deps.calls.get(callId);
  if (!call || call.userId !== actorId) return err("not-found");
  if (call.endedAt === null) return err("call-open");
  const contact = call.contactId ? deps.contacts.get(call.contactId) : null;
  if (!contact?.email) return err("no-email");
  const client = deps.clients.get(call.organizationId);
  const draft = draftRecap({ name: contact.name, me: deps.users.get(call.userId)?.name ?? "", notes: call.note });
  return ok({
    callId,
    clientId: call.organizationId,
    clientName: client?.name ?? "",
    toName: contact.name,
    to: contact.email,
    ...draft,
    sentText: call.recapSentAt ? deps.formatWhen(call.recapSentAt) : "",
    skipTo: call.returnTo ?? (call.opportunityId ? `/opportunities/${call.opportunityId}#touches` : `/clients/${call.organizationId}#touches`),
  });
}

/** Sends a message; true when it went. The app's mail, given only where email is set up. */
export type RecapMail = (message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>;

/**
 * Sends the recap as edited, once, and logs it in the call log as an email.
 * Never sent without someone pressing Send; with email off it says so.
 */
export async function sendRecap(deps: CallDeps, mail: RecapMail | null, actorId: Id | null, callId: Id, input: { readonly subject: string; readonly body: string }): Promise<Result<RecapView, Refused | "call-open" | "no-email" | "recap-sent" | "email-off" | "email-failed" | RecapError>> {
  const recap = recapFor(deps, actorId, callId);
  if (!recap.ok) return recap;
  if (recap.value.sentText) return err("recap-sent");
  const read = readRecap(input);
  if (!read.ok) return read;
  if (!mail) return err("email-off");
  if (!(await mail({ to: recap.value.to, subject: read.value.subject, body: read.value.body }))) return err("email-failed");
  return deps.transact(() => {
    const call = deps.calls.get(callId);
    if (!call || !deps.calls.recapSent(callId, deps.clock())) return err("recap-sent");
    const where = call.opportunityId ? { opportunityId: call.opportunityId } : { clientId: call.organizationId };
    const note = `Sent a recap of the call: “${read.value.subject}”.\n\n${read.value.body}`;
    writeTouch(deps, actorId, where, { kind: "email", note: note.length <= 2000 ? note : `${note.slice(0, 1999)}…`, contactId: call.contactId });
    recordActivity(deps, { actorId: actorId as Id, action: "call.recap-sent", recordType: "call", recordId: callId, context: { clientId: call.organizationId, contactId: call.contactId ?? "" } });
    return ok({ ...recap.value, sentText: deps.formatWhen(deps.clock()) });
  });
}

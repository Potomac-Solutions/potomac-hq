// The eleven AI features of decision 0012, each a draft for a person to use.
// Facts are read with the reader in `records` or through other modules'
// services in `links`, which check their own permissions; using a draft goes
// through those services too, so a draft can do nothing its user couldn't.
import { base64Of, fingerprintOf, MAX_RECEIPT_BYTES, receiptKind } from "../domain/files.ts";
import {
  askPrompt,
  briefPrompt,
  caseStudyPrompt,
  checkInPrompt,
  diagnosisPrompt,
  postsPrompt,
  proposalPrompt,
  readAsk,
  readBrief,
  readCaseStudy,
  readDiagnosis,
  readMail,
  readPosts,
  readProposal,
  readReceipt,
  readRecap,
  readScope,
  readTriage,
  readUpdate,
  receiptPrompt,
  recapPrompt,
  scopePrompt,
  triagePrompt,
  updatePrompt,
  type AskDraft,
  type BriefDraft,
  type CaseStudyDraft,
  type DiagnosisDraft,
  type MailDraft,
  type PostsDraft,
  type ProposalDraft,
  type ReceiptDraft,
  type RecapDraft,
  type ScopeDraft,
  type TriageDraft,
  type UpdateDraft,
  type WorkFacts,
} from "../domain/prompts.ts";
import type { Feature } from "../domain/settings.ts";
import { draftWith, latestDraft, mayUse, openDraft, settleDraft, type AiDeps, type AiProblem, type Drafted } from "./ai.ts";
import type { AiRecords, Draft, ProjectFacts } from "./ports.ts";
import { err, ok, type Id, type Result } from "../../shared/index.ts";

type Answer<T> = Result<T, string>;

/** What other modules do for AI: each checks its own permissions. */
export type AiLinks = {
  /** An ended call's recap facts, for the person who made it; "no-email" when the contact has none. */
  recap(actorId: Id, callId: Id): { readonly client: string; readonly contact: string; readonly me: string; readonly notes: string; readonly organizationId: Id; readonly opportunityId: Id | null } | "no-email" | null;
  /** Getting ready for a booked call, as its page shows it. */
  getReady(actorId: Id, bookingId: Id): { readonly organizationId: Id | null; readonly client: string; readonly contact: string; readonly why: string; readonly points: readonly string[] } | null;
  addTodo(actorId: Id, input: { readonly title: string; readonly clientId: Id; readonly opportunityId: Id | null }): Answer<unknown>;
  /** Logs an email sent to a contact, on a deal. */
  logEmail(actorId: Id, opportunityId: Id, contactId: Id | null, note: string): Answer<unknown>;
  addNote(actorId: Id, opportunityId: Id, body: string): Answer<unknown>;
  markLost(actorId: Id, opportunityId: Id, reason: string): Answer<unknown>;
  /** Starts a proposal on a deal from the draft; its id. */
  startProposal(actorId: Id, opportunityId: Id, draft: ProposalDraft): Answer<Id>;
  addChange(actorId: Id, projectId: Id, input: { readonly title: string; readonly description: string; readonly amount: string; readonly hours: string }): Answer<unknown>;
  postUpdate(actorId: Id, projectId: Id, body: string): Answer<unknown>;
  addExpense(actorId: Id, projectId: Id, input: { readonly category: string; readonly amount: string; readonly on: string; readonly note: string }, receipt: { readonly name: string; readonly bytes: Uint8Array } | null): Answer<unknown>;
  /** A service's proposal template, as typed text. */
  template(service: string): { readonly scope: string; readonly assumptions: string; readonly exclusions: string; readonly deliverables: string; readonly lines: readonly { readonly item: string; readonly kind: string; readonly quantity: string; readonly rate: string }[] } | null;
  readonly services: readonly { readonly key: string; readonly label: string }[];
  readonly expenseCategories: readonly string[];
};

export type FeaturesDeps = AiDeps & {
  readonly records: AiRecords;
  readonly links: AiLinks;
  readonly today: () => string;
  /** The first instant of a day in the business time zone. */
  readonly startOfDay: (day: string) => string;
};

/** Sends an email to a client's contact; true when it went. The app's mail, where email is set up. */
export type AiMail = (message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>;

type Problem = AiProblem | "no-email" | "already-decided" | "email-off" | "email-failed" | "subject-missing" | "body-missing" | "nothing-to-draft";

const named = (deps: FeaturesDeps, id: Id | null): string => (id ? deps.records.userName(id) || "Mikey" : "Mikey");
const daysBefore = (day: string, days: number): string => Temporal.PlainDate.from(day).subtract({ days }).toString();
const daysAfter = (day: string, days: number): string => Temporal.PlainDate.from(day).add({ days }).toString();
const short = (at: string): string => at.slice(0, 10);

/** A waiting draft of a feature for a record, if this person may see it. */
export function waitingDraft<T>(deps: FeaturesDeps, actorId: Id | null, feature: Feature, recordId: string): Drafted<T> | null {
  const found = latestDraft<T>(deps, actorId, feature, recordId);
  return found && found.status === "waiting" ? found : null;
}

// ---- Phase 1: calls ---------------------------------------------------------

/** Drafts the recap email and next steps for an ended call. Only the person who made it. */
export async function draftCallRecap(deps: FeaturesDeps, actorId: Id | null, callId: Id, transcript: string): Promise<Result<Drafted<RecapDraft>, Problem>> {
  if (actorId === null || !mayUse(deps, actorId, "call-recap")) return err("forbidden");
  const facts = deps.links.recap(actorId, callId);
  if (facts === null) return err("not-found");
  if (facts === "no-email") return err("no-email");
  if (!facts.notes.trim() && !transcript.trim()) return err("nothing-to-draft");
  return draftWith(deps, actorId, { feature: "call-recap", recordType: "call", recordId: callId, prompt: recapPrompt({ client: facts.client, contact: facts.contact, me: facts.me, notes: facts.notes, transcript: transcript.trim().slice(0, 30_000) }), read: readRecap });
}

/** Adds a recap draft's next steps as to-dos at the call's client. */
export function addRecapSteps(deps: FeaturesDeps, actorId: Id | null, draftId: Id): Result<number, Problem> {
  const found = openDraft(deps, actorId, draftId, "call-recap");
  if (!found.ok) return found;
  const facts = deps.links.recap(actorId as Id, found.value.recordId as Id);
  if (facts === null || facts === "no-email") return err("not-found");
  let added = 0;
  for (const title of (found.value.content as RecapDraft).nextSteps) if (deps.links.addTodo(actorId as Id, { title: title.slice(0, 200), clientId: facts.organizationId, opportunityId: facts.opportunityId }).ok) added++;
  return ok(added);
}

/** Writes a brief for a booked call from what HQ knows about the client. */
export async function draftCallBrief(deps: FeaturesDeps, actorId: Id | null, bookingId: Id): Promise<Result<Drafted<BriefDraft>, Problem>> {
  if (actorId === null || !mayUse(deps, actorId, "call-brief")) return err("forbidden");
  const ready = deps.links.getReady(actorId, bookingId);
  if (!ready) return err("not-found");
  const facts = { client: ready.client || "a new client", contact: ready.contact, why: ready.why, points: ready.points, recent: ready.organizationId ? deps.records.touches({ organizationId: ready.organizationId }, 6).map((one) => ({ when: short(one.at), kind: one.kind, note: one.note })) : [] };
  const made = await draftWith(deps, actorId, { feature: "call-brief", recordType: "booking", recordId: bookingId, prompt: briefPrompt(facts), read: readBrief, fingerprint: fingerprintOf(facts) });
  // A brief is read where it's written: nothing waits on it.
  if (made.ok) deps.transact(() => settleDraft(deps, actorId, made.value, "used"));
  return made;
}

/** The brief for a booked call, and whether HQ's records have changed since it was written. */
export function callBrief(deps: FeaturesDeps, actorId: Id | null, bookingId: Id): { readonly lines: readonly string[]; readonly when: string; readonly stale: boolean } | null {
  const draft = latestDraft<BriefDraft>(deps, actorId, "call-brief", bookingId);
  if (!draft || actorId === null) return null;
  const ready = deps.links.getReady(actorId, bookingId);
  const now = ready ? fingerprintOf({ client: ready.client || "a new client", contact: ready.contact, why: ready.why, points: ready.points, recent: ready.organizationId ? deps.records.touches({ organizationId: ready.organizationId }, 6).map((one) => ({ when: short(one.at), kind: one.kind, note: one.note })) : [] }) : draft.fingerprint;
  return { lines: draft.content.lines, when: deps.formatWhen(draft.createdAt), stale: now !== draft.fingerprint };
}

// ---- Phase 2: sales ---------------------------------------------------------

/** Triages a deal: by a person from its page, or by HQ itself (null) as leads come in. */
export async function triageDeal(deps: FeaturesDeps, actorId: Id | null, opportunityId: Id): Promise<Result<Drafted<TriageDraft>, Problem>> {
  if (!mayUse(deps, actorId, "lead-triage")) return err("forbidden");
  const deal = deps.records.deal(opportunityId);
  if (!deal) return err("not-found");
  const services = deps.links.services;
  const facts = { from: deal.contact, business: deal.client, message: deal.summary || deal.title, chose: services.find((one) => one.key === deal.service)?.label ?? "", source: deal.leadSource, services, priceGuide: deps.ai.settings().priceGuide, me: named(deps, deal.ownerId) };
  return draftWith(deps, actorId, { feature: "lead-triage", recordType: "opportunity", recordId: opportunityId, prompt: triagePrompt(facts), read: (answer) => readTriage(answer, services.map((one) => one.key)) });
}

/** HQ's own run: triages new deals from the last two days not yet triaged. How many it did. */
export async function triageNewLeads(deps: FeaturesDeps): Promise<number> {
  const settings = deps.ai.settings();
  if (!deps.model || !settings.features.includes("lead-triage")) return 0;
  const since = deps.startOfDay(daysBefore(deps.today(), 2));
  let done = 0;
  for (const id of deps.records.untriaged(since, (one) => deps.ai.latest("lead-triage", one) !== null).slice(0, 10)) {
    const made = await triageDeal(deps, null, id);
    if (made.ok) done++;
    else if (made.error === "budget-reached" || made.error === "no-key" || made.error === "feature-off") break;
  }
  return done;
}

/** Drafts a check-in for a deal that's gone quiet. */
export async function draftCheckIn(deps: FeaturesDeps, actorId: Id | null, opportunityId: Id): Promise<Result<Drafted<MailDraft>, Problem>> {
  if (actorId === null || !mayUse(deps, actorId, "check-in")) return err("forbidden");
  const deal = deps.records.deal(opportunityId);
  if (!deal) return err("not-found");
  if (!deal.contactEmail) return err("no-email");
  const last = deps.records.touches({ opportunityId }, 1)[0] ?? deps.records.touches({ organizationId: deal.organizationId }, 1)[0] ?? null;
  const facts = { client: deal.client, contact: deal.contact, deal: deal.title, summary: deal.summary, last: last ? { when: short(last.at), kind: last.kind, note: last.note } : null, me: named(deps, actorId) };
  return draftWith(deps, actorId, { feature: "check-in", recordType: "opportunity", recordId: opportunityId, prompt: checkInPrompt(facts), read: readMail });
}

/**
 * Sends a deal's drafted email as edited, to its contact, and logs it on the
 * deal: lead triage's reply, or a check-in. Never without someone pressing Send.
 */
export async function sendDealEmail(deps: FeaturesDeps, mail: AiMail | null, actorId: Id | null, draftId: Id, input: { readonly subject: string; readonly body: string }): Promise<Result<Draft, Problem>> {
  const found = openDraft(deps, actorId, draftId);
  if (!found.ok) return found;
  if (found.value.feature !== "lead-triage" && found.value.feature !== "check-in") return err("not-found");
  const subject = input.subject.trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!subject || subject.length > 150) return err("subject-missing");
  if (!body || body.length > 4000) return err("body-missing");
  const deal = deps.records.deal(found.value.recordId as Id);
  if (!deal) return err("not-found");
  if (!deal.contactEmail) return err("no-email");
  if (!mail) return err("email-off");
  if (!(await mail({ to: deal.contactEmail, subject, body }))) return err("email-failed");
  const note = `Sent: “${subject}”.\n\n${body}`;
  deps.links.logEmail(actorId as Id, deal.id, deal.contactId, note.length <= 2000 ? note : `${note.slice(0, 1999)}…`);
  deps.transact(() => settleDraft(deps, actorId as Id, found.value, "used"));
  return ok(found.value);
}

/** Keeps a triage on the deal as a note. The draft stays, for its reply. */
export function noteTriage(deps: FeaturesDeps, actorId: Id | null, draftId: Id): Result<Draft, Problem | string> {
  const found = openDraft(deps, actorId, draftId, "lead-triage");
  if (!found.ok) return found;
  const t = found.value.content as TriageDraft;
  const service = deps.links.services.find((one) => one.key === t.service)?.label ?? "Not sure";
  const body = [`AI triage: ${t.need}`, `Service: ${service}. Price range: ${t.priceRange || "not given"}.`, `Business: ${t.businessType || "not given"}. Urgency: ${t.urgency}.${t.spam ? " Looks like spam." : ""}`, `Why: ${t.reason}`].join("\n");
  const noted = deps.links.addNote(actorId as Id, found.value.recordId as Id, body);
  return noted.ok ? ok(found.value) : err(noted.error);
}

/** Closes a spam lead as lost, and the triage with it. */
export function closeAsSpam(deps: FeaturesDeps, actorId: Id | null, draftId: Id): Result<Draft, Problem | string> {
  const found = openDraft(deps, actorId, draftId, "lead-triage");
  if (!found.ok) return found;
  const lost = deps.links.markLost(actorId as Id, found.value.recordId as Id, "Spam");
  if (!lost.ok) return err(lost.error);
  // Its own transaction: each module's service holds its own.
  deps.transact(() => settleDraft(deps, actorId as Id, found.value, "used"));
  return ok(found.value);
}

/** Drafts a proposal for a deal, from its template and notes, checked against similar finished jobs. */
export async function draftProposal(deps: FeaturesDeps, actorId: Id | null, opportunityId: Id): Promise<Result<Drafted<ProposalDraft>, Problem>> {
  if (actorId === null || !mayUse(deps, actorId, "proposal-draft")) return err("forbidden");
  const deal = deps.records.deal(opportunityId);
  if (!deal) return err("not-found");
  const service = deal.service ?? "";
  const template = deps.links.template(service) ?? { scope: "", assumptions: "", exclusions: "", deliverables: "", lines: [] };
  const facts = {
    deal: deal.title,
    client: deal.client,
    service: deps.links.services.find((one) => one.key === service)?.label ?? "Not chosen yet",
    summary: deal.summary,
    notes: deps.records.touches({ opportunityId }, 8).map((one) => `${short(one.at)} ${one.kind}: ${one.note}`),
    template,
    similar: service ? deps.records.similarJobs(service, 5) : [],
    priceGuide: deps.ai.settings().priceGuide,
  };
  return draftWith(deps, actorId, { feature: "proposal-draft", recordType: "opportunity", recordId: opportunityId, prompt: proposalPrompt(facts), read: readProposal });
}

/** Starts a proposal from the draft, to edit before it's sent. Its id. */
export function useProposalDraft(deps: FeaturesDeps, actorId: Id | null, draftId: Id): Result<Id, Problem | string> {
  const found = openDraft(deps, actorId, draftId, "proposal-draft");
  if (!found.ok) return found;
  const made = deps.links.startProposal(actorId as Id, found.value.recordId as Id, found.value.content as ProposalDraft);
  if (!made.ok) return err(made.error);
  // Its own transaction: each module's service holds its own.
  deps.transact(() => settleDraft(deps, actorId as Id, found.value, "used"));
  return ok(made.value);
}

// ---- Phase 3: delivery ------------------------------------------------------

function scopeFacts(deps: FeaturesDeps, project: ProjectFacts, message: string) {
  return { project: `${project.name} for ${project.client}`, message, agreed: project.agreed ?? { scope: project.summary, deliverables: "", exclusions: "", lines: [] }, changes: project.changes, priceGuide: deps.ai.settings().priceGuide };
}

/**
 * Checks one client message against what was agreed. Out of scope, the draft
 * waits on the project with a change request; in scope, it's kept as checked
 * and nobody is bothered.
 */
export async function checkScope(deps: FeaturesDeps, actorId: Id | null, message: { readonly id: Id; readonly projectId: Id; readonly body: string }): Promise<Result<Drafted<ScopeDraft>, Problem>> {
  if (!mayUse(deps, actorId, "scope-check")) return err("forbidden");
  const project = deps.records.project(message.projectId);
  if (!project || project.status !== "active") return err("not-found");
  const made = await draftWith(deps, actorId, { feature: "scope-check", recordType: "project", recordId: project.id, prompt: scopePrompt(scopeFacts(deps, project, message.body)), read: readScope, fingerprint: message.id });
  if (made.ok && !made.value.content.outOfScope) deps.transact(() => deps.ai.decide(made.value.id, "discarded", null, deps.clock()));
  return made;
}

/** HQ's own run: checks client messages from the last day not yet checked. How many were out of scope. */
export async function checkNewMessages(deps: FeaturesDeps): Promise<number> {
  const settings = deps.ai.settings();
  if (!deps.model || !settings.features.includes("scope-check")) return 0;
  let flagged = 0;
  for (const message of deps.records.clientMessages(deps.startOfDay(daysBefore(deps.today(), 1))).filter((one) => !deps.ai.hasFingerprint("scope-check", one.id)).slice(0, 10)) {
    const made = await checkScope(deps, null, message);
    if (made.ok && made.value.content.outOfScope) flagged++;
    if (!made.ok && (made.error === "budget-reached" || made.error === "no-key")) break;
  }
  return flagged;
}

/** Drafts the change request a flagged message asked for, to send from the project's money page. */
export function useScopeDraft(deps: FeaturesDeps, actorId: Id | null, draftId: Id): Result<Draft, Problem | string> {
  const found = openDraft(deps, actorId, draftId, "scope-check");
  if (!found.ok) return found;
  const change = (found.value.content as ScopeDraft).change;
  if (!change) return err("not-found");
  const made = deps.links.addChange(actorId as Id, found.value.recordId as Id, { title: change.title, description: change.description, amount: change.amount.toFixed(2), hours: String(change.hours) });
  if (!made.ok) return err(made.error);
  // Its own transaction: each module's service holds its own.
  deps.transact(() => settleDraft(deps, actorId as Id, found.value, "used"));
  return ok(found.value);
}

/** The Monday a day's week starts on. */
const weekStart = (day: string): string => daysBefore(day, Temporal.PlainDate.from(day).dayOfWeek - 1);

/** Drafts this week's update on a project. By a person, or by HQ itself on Fridays. */
export async function draftWeeklyUpdate(deps: FeaturesDeps, actorId: Id | null, projectId: Id): Promise<Result<Drafted<UpdateDraft>, Problem>> {
  if (!mayUse(deps, actorId, "weekly-update")) return err("forbidden");
  const project = deps.records.project(projectId);
  if (!project || project.status !== "active") return err("not-found");
  const today = deps.today();
  const monday = weekStart(today);
  const week = deps.records.week(projectId, deps.startOfDay(monday), deps.startOfDay(daysAfter(today, 1)), daysAfter(today, 7));
  const facts = { project: project.name, client: project.client, week: `Week of ${monday}`, ...week, milestones: project.milestones.filter((one) => !one.doneOn).map((one) => (one.dueOn ? `${one.name} (due ${one.dueOn})` : one.name)), me: named(deps, actorId ?? project.ownerId) };
  return draftWith(deps, actorId, { feature: "weekly-update", recordType: "project", recordId: projectId, prompt: updatePrompt(facts), read: readUpdate, fingerprint: `${projectId}:${monday}` });
}

/** HQ's own run on Fridays: a draft for each active project that has none this week. */
export async function draftWeeklyUpdates(deps: FeaturesDeps): Promise<number> {
  const settings = deps.ai.settings();
  if (!deps.model || !settings.features.includes("weekly-update")) return 0;
  const monday = weekStart(deps.today());
  let done = 0;
  for (const id of deps.records.activeProjects().filter((one) => !deps.ai.hasFingerprint("weekly-update", `${one}:${monday}`)).slice(0, 30)) {
    const made = await draftWeeklyUpdate(deps, null, id);
    if (made.ok) done++;
    else if (made.error === "budget-reached" || made.error === "no-key") break;
  }
  return done;
}

/** Posts a weekly update to the client's portal, as edited. */
export function postWeeklyUpdate(deps: FeaturesDeps, actorId: Id | null, draftId: Id, body: string): Result<Draft, Problem | string> {
  const found = openDraft(deps, actorId, draftId, "weekly-update");
  if (!found.ok) return found;
  const text = body.replace(/\r\n/g, "\n").trim();
  if (!text) return err("body-missing");
  const posted = deps.links.postUpdate(actorId as Id, found.value.recordId as Id, text);
  if (!posted.ok) return err(posted.error);
  // Its own transaction: each module's service holds its own.
  deps.transact(() => settleDraft(deps, actorId as Id, found.value, "used"));
  return ok(found.value);
}

/** Asks HQ a question, answered from the knowledge base and decision log. */
export async function askHq(deps: FeaturesDeps, actorId: Id | null, question: string): Promise<Result<Drafted<AskDraft>, Problem | "question-missing">> {
  if (actorId === null || !mayUse(deps, actorId, "ask")) return err("forbidden");
  const asked = question.replace(/\s+/g, " ").trim();
  if (!asked || asked.length > 500) return err("question-missing");
  const articles = deps.records.articles(asked.split(/[^A-Za-z0-9]+/), 6);
  const made = await draftWith(deps, actorId, { feature: "ask", recordType: "user", recordId: actorId, prompt: askPrompt({ question: asked, articles }), read: (answer) => readAsk(answer, asked, articles.map((one) => one.slug)) });
  if (made.ok) deps.transact(() => settleDraft(deps, actorId, made.value, "used"));
  return made;
}

/** The last answer this person was given. */
export const lastAnswer = (deps: FeaturesDeps, actorId: Id | null): Drafted<AskDraft> | null => latestDraft<AskDraft>(deps, actorId, "ask", actorId ?? "");

// ---- Phase 4: money and admin -------------------------------------------------

/** Reads a receipt's photo or PDF into a draft expense on a project. */
export async function readReceiptFile(deps: FeaturesDeps, actorId: Id | null, projectId: Id, file: { readonly name: string; readonly bytes: Uint8Array } | null): Promise<Result<Drafted<ReceiptDraft>, Problem | "receipt-missing" | "receipt-kind" | "receipt-too-big">> {
  if (actorId === null || !mayUse(deps, actorId, "receipt")) return err("forbidden");
  if (!deps.records.project(projectId)) return err("not-found");
  if (!file || file.bytes.length === 0) return err("receipt-missing");
  if (file.bytes.length > MAX_RECEIPT_BYTES) return err("receipt-too-big");
  const kind = receiptKind(file.bytes);
  if (!kind) return err("receipt-kind");
  const categories = deps.links.expenseCategories;
  return draftWith(deps, actorId, { feature: "receipt", recordType: "project", recordId: projectId, prompt: receiptPrompt({ categories, today: deps.today() }, { mediaType: kind, base64: base64Of(file.bytes) }), read: (answer) => readReceipt(answer, categories), attachment: { name: file.name.slice(0, 200) || "receipt", bytes: file.bytes } });
}

/** Adds the expense as checked, with the receipt attached. */
export function useReceiptDraft(deps: FeaturesDeps, actorId: Id | null, draftId: Id, input: { readonly category: string; readonly amount: string; readonly on: string; readonly note: string }): Result<Draft, Problem | string> {
  const found = openDraft(deps, actorId, draftId, "receipt");
  if (!found.ok) return found;
  const added = deps.links.addExpense(actorId as Id, found.value.recordId as Id, input, deps.ai.attachment(draftId));
  if (!added.ok) return err(added.error);
  // Its own transaction: each module's service holds its own.
  deps.transact(() => settleDraft(deps, actorId as Id, found.value, "used"));
  return ok(found.value);
}

/**
 * A site alert with AI's likely cause and first step added, when it's on.
 * Never holds an alert up: anything that goes wrong sends it as it was.
 */
export async function withDiagnosis(deps: FeaturesDeps, message: { readonly subject: string; readonly body: string }): Promise<{ readonly subject: string; readonly body: string }> {
  try {
    const url = /https?:\/\/[^\s)]+/.exec(message.body)?.[0] ?? "";
    const site = url ? deps.records.site(url.replace(/[.,]$/, "")) : null;
    if (!site || !deps.model || !deps.ai.settings().features.includes("site-diagnosis")) return message;
    const made = await draftWith(deps, null, { feature: "site-diagnosis", recordType: "site", recordId: site.id, prompt: diagnosisPrompt({ url: site.url, what: `${message.subject}\n${message.body}`, lastResult: site.lastResult, certExpiresOn: site.certExpiresOn, recentOutages: site.outages }), read: readDiagnosis });
    if (!made.ok) return message;
    // Delivered in the alert itself: nothing waits on it.
    deps.transact(() => deps.ai.decide(made.value.id, "used", null, deps.clock()));
    return { subject: message.subject, body: `${message.body}\n\nLikely cause (AI): ${made.value.content.cause}\nFirst step: ${made.value.content.firstStep}` };
  } catch {
    return message;
  }
}

// ---- Phase 5: marketing -------------------------------------------------------

function workFacts(project: ProjectFacts, services: FeaturesDeps["links"]["services"]): WorkFacts {
  return {
    client: project.client,
    project: project.name,
    service: services.find((one) => one.key === project.service)?.label ?? "",
    summary: project.summary,
    scope: project.agreed ? [project.agreed.scope, project.agreed.deliverables].filter(Boolean).join("\n\n") : "",
    milestones: project.milestones.filter((one) => one.doneOn).map((one) => one.name),
    links: project.sharedLinks,
    started: short(project.createdAt),
    finished: project.status === "completed" ? short(project.updatedAt) : "",
  };
}

export async function draftCaseStudy(deps: FeaturesDeps, actorId: Id | null, projectId: Id): Promise<Result<Drafted<CaseStudyDraft>, Problem>> {
  if (actorId === null || !mayUse(deps, actorId, "case-study")) return err("forbidden");
  const project = deps.records.project(projectId);
  if (!project) return err("not-found");
  return draftWith(deps, actorId, { feature: "case-study", recordType: "project", recordId: projectId, prompt: caseStudyPrompt(workFacts(project, deps.links.services)), read: readCaseStudy });
}

export async function draftSocialPosts(deps: FeaturesDeps, actorId: Id | null, projectId: Id): Promise<Result<Drafted<PostsDraft>, Problem>> {
  if (actorId === null || !mayUse(deps, actorId, "social-posts")) return err("forbidden");
  const project = deps.records.project(projectId);
  if (!project) return err("not-found");
  return draftWith(deps, actorId, { feature: "social-posts", recordType: "project", recordId: projectId, prompt: postsPrompt(workFacts(project, deps.links.services)), read: readPosts });
}

export type MarketingLine = { readonly id: string; readonly kind: "case-study" | "social-posts"; readonly project: string; readonly projectId: string; readonly when: string; readonly caseStudy: CaseStudyDraft | null; readonly posts: PostsDraft | null };

/** The marketing queue: case studies and posts waiting to be used. */
export function marketingQueue(deps: FeaturesDeps, actorId: Id | null): readonly MarketingLine[] | null {
  if (actorId === null || !mayUse(deps, actorId, "case-study")) return null;
  return deps.ai
    .waiting(200)
    .filter((draft) => draft.feature === "case-study" || draft.feature === "social-posts")
    .map((draft) => ({
      id: draft.id,
      kind: draft.feature as "case-study" | "social-posts",
      project: deps.records.project(draft.recordId as Id)?.name ?? "A project",
      projectId: draft.recordId,
      when: deps.formatWhen(draft.createdAt),
      caseStudy: draft.feature === "case-study" ? (draft.content as CaseStudyDraft) : null,
      posts: draft.feature === "social-posts" ? (draft.content as PostsDraft) : null,
    }));
}

/** A line for the Drafts page: what each waiting draft is about. */
export function describeDraft(deps: FeaturesDeps, draft: Draft): string {
  const deal = () => deps.records.deal(draft.recordId as Id);
  const project = () => deps.records.project(draft.recordId as Id);
  switch (draft.feature) {
    case "lead-triage": {
      const t = draft.content as TriageDraft;
      return `${deal()?.client ?? "A lead"}: ${t.spam ? "looks like spam" : t.need}`;
    }
    case "check-in":
    case "proposal-draft":
      return deal()?.title ?? "A deal";
    case "scope-check":
      return `${project()?.name ?? "A project"}: ${(draft.content as ScopeDraft).change?.title ?? ""}`;
    case "weekly-update":
    case "case-study":
    case "social-posts":
      return project()?.name ?? "A project";
    case "receipt": {
      const r = draft.content as ReceiptDraft;
      return `${r.vendor || "A receipt"}${r.amount !== null ? `, $${r.amount.toFixed(2)}` : ""} on ${project()?.name ?? "a project"}`;
    }
    case "site-diagnosis":
      return (draft.content as DiagnosisDraft).cause;
    case "call-recap":
      return "A recap email";
    case "call-brief":
      return "A brief before a call";
    default:
      return "";
  }
}

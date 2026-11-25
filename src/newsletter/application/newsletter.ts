// The newsletter (decision 0010, section 1). Anyone signs up, from the website
// or HQ's own page, and is on the list once they open the confirm link they
// are emailed. Potomac's people with `newsletter.manage` see the list, write
// issues and send them; issues go out in the background, a batch a minute,
// each person once. Anyone leaves with one click.
import { afterSignUp, audienceText, CONFIRM_DAYS, inAudience, isStop, issueEmail, issueFields, SENDS_PER_MINUTE, signUpFields, STOP_LABELS, STOPS, stopFrom, type Issue, type IssueError, type SignUpError, type Stop, type Subscriber } from "../domain/newsletter.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { IssueStore, LinkTokens, NewsletterMail, SendStore, SubscriberStore } from "./ports.ts";

export type NewsletterDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly subscribers: SubscriberStore;
  readonly issues: IssueStore;
  readonly sends: SendStore;
  readonly tokens: LinkTokens;
  readonly formatWhen: (instant: string) => string;
  /** The CRM client with a contact at this email, if there is one: a reader who is also a lead. */
  readonly clientByEmail: (email: string) => { readonly id: Id; readonly name: string } | null;
};

/** The river stops, for forms. */
export { STOPS };

type Refused = "forbidden" | "not-found";
const allowed = (deps: NewsletterDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "newsletter.manage").ok;

// ---------- Signing up and leaving: anyone ----------

export type SignUpInput = { readonly email: string; readonly name?: string | null; readonly src?: string | null; readonly source: "site" | "page" };
/** Who to email a confirm link to, or null when they're already on the list and nothing is sent. */
export type SignedUp = { readonly confirm: { readonly email: string; readonly name: string | null; readonly token: string } | null };

/**
 * Someone signs up. They get a confirm link by email; nothing else happens
 * until they open it. Signing up while already on the list changes nothing,
 * and the answer is the same either way, so the form never tells a stranger
 * who is on the list.
 */
export function signUp(deps: NewsletterDeps, input: SignUpInput): Result<SignedUp, SignUpError> {
  const fields = signUpFields(input);
  if (!fields.ok) return fields;
  const { email, name } = fields.value;
  const stop = stopFrom(input.src ?? "");
  return deps.transact(() => {
    const at = deps.clock();
    const expiresAt = Temporal.Instant.from(at).add({ hours: 24 * CONFIRM_DAYS }).toString();
    const token = deps.tokens.newToken();
    const emailHash = deps.tokens.hash(email);
    const existing = deps.subscribers.byEmailHash(emailHash);
    const next = afterSignUp(existing);
    if (next === "already") return ok({ confirm: null });
    if (next === "new" || !existing) {
      const subscriber: Subscriber = { id: deps.newId(), email, emailHash, name, stop, status: "pending", source: input.source, confirmedAt: null, unsubscribedAt: null, createdAt: at };
      deps.subscribers.insert(subscriber, { confirmHash: deps.tokens.hash(token), confirmExpiresAt: expiresAt, unsubscribeToken: deps.tokens.newToken() });
      recordActivity(deps, { actorId: null, action: "newsletter-subscriber.signed-up", recordType: "newsletter-subscriber", recordId: subscriber.id, context: { stop, source: input.source } });
      return ok({ confirm: { email, name, token } });
    }
    // Pending, or back after leaving: a fresh link. Someone who left starts again as pending.
    const again: Subscriber = { ...existing, email, name: name ?? existing.name, status: "pending", unsubscribedAt: null };
    deps.subscribers.save(again, at);
    deps.subscribers.setConfirm(existing.id, { hash: deps.tokens.hash(token), expiresAt }, at);
    recordActivity(deps, { actorId: null, action: next === "again" ? "newsletter-subscriber.signed-up" : "newsletter-subscriber.link-resent", recordType: "newsletter-subscriber", recordId: existing.id, context: { stop: again.stop, source: input.source } });
    return ok({ confirm: { email, name: again.name, token } });
  });
}

const tokenShape = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

/** Whether a confirm link works, for the page that asks them to press Confirm. Changes nothing. */
export function confirmLinkWorks(deps: NewsletterDeps, token: string): boolean {
  if (!tokenShape(token)) return false;
  const found = deps.subscribers.byConfirmHash(deps.tokens.hash(token));
  return found !== null && found.subscriber.status === "pending" && Temporal.Instant.compare(found.expiresAt, deps.clock()) > 0;
}

/** They pressed Confirm: they're on the list. The link works once. */
export function confirmSubscription(deps: NewsletterDeps, token: string): Result<Subscriber, "invalid-link"> {
  if (!tokenShape(token)) return err("invalid-link");
  return deps.transact(() => {
    const found = deps.subscribers.byConfirmHash(deps.tokens.hash(token));
    if (!found || found.subscriber.status !== "pending" || Temporal.Instant.compare(found.expiresAt, deps.clock()) <= 0) return err("invalid-link");
    const at = deps.clock();
    const on: Subscriber = { ...found.subscriber, status: "subscribed", confirmedAt: at };
    deps.subscribers.save(on, at);
    deps.subscribers.setConfirm(on.id, null, at);
    recordActivity(deps, { actorId: null, action: "newsletter-subscriber.confirmed", recordType: "newsletter-subscriber", recordId: on.id, context: { stop: on.stop } });
    return ok(on);
  });
}

/** Whether an unsubscribe link is one HQ made, for the page that offers the button. */
export function unsubscribeLinkWorks(deps: NewsletterDeps, token: string): boolean {
  return tokenShape(token) && deps.subscribers.byUnsubscribeToken(token) !== null;
}

/**
 * They left. Their email and name are forgotten; only the one-way hash stays,
 * so no list ever mails them again by mistake. Leaving twice is fine.
 */
export function unsubscribe(deps: NewsletterDeps, token: string): Result<null, "invalid-link"> {
  if (!tokenShape(token)) return err("invalid-link");
  return deps.transact(() => {
    const found = deps.subscribers.byUnsubscribeToken(token);
    if (!found) return err("invalid-link");
    if (found.status === "unsubscribed") return ok(null);
    const at = deps.clock();
    deps.subscribers.save({ ...found, status: "unsubscribed", email: null, name: null, unsubscribedAt: at }, at);
    deps.subscribers.setConfirm(found.id, null, at);
    recordActivity(deps, { actorId: null, action: "newsletter-subscriber.unsubscribed", recordType: "newsletter-subscriber", recordId: found.id, context: { stop: found.stop } });
    return ok(null);
  });
}

// ---------- The list and issues: newsletter.manage ----------

export type SubscriberLine = { readonly id: string; readonly email: string; readonly name: string; readonly stop: Stop; readonly stopLabel: string; readonly pending: boolean; readonly since: string; readonly client: { readonly id: string; readonly name: string } | null };
export type IssueLine = { readonly id: string; readonly subject: string; readonly audience: string; readonly status: string; readonly when: string };
export type NewsletterView = {
  readonly subscribed: number;
  readonly pending: number;
  readonly left: number;
  readonly byStop: readonly { readonly stop: Stop; readonly label: string; readonly count: number }[];
  readonly subscribers: readonly SubscriberLine[];
  readonly issues: readonly IssueLine[];
  readonly stops: readonly { readonly value: Stop; readonly label: string }[];
};

const STATUS_TEXT: Readonly<Record<Issue["status"], string>> = { draft: "Draft", sending: "Sending", sent: "Sent" };
const stopOptions = () => STOPS.map((value) => ({ value, label: STOP_LABELS[value] }));

export function newsletterOverview(deps: NewsletterDeps, actorId: Id | null): Result<NewsletterView, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const counts = deps.subscribers.countsByStatus();
  const current = deps.subscribers.listCurrent();
  const subscribed = current.filter((one) => one.status === "subscribed");
  return ok({
    subscribed: counts.subscribed,
    pending: counts.pending,
    left: counts.unsubscribed,
    byStop: STOPS.map((stop) => ({ stop, label: STOP_LABELS[stop], count: subscribed.filter((one) => one.stop === stop).length })),
    subscribers: current.map((one) => {
      const client = one.email ? deps.clientByEmail(one.email) : null;
      return { id: one.id, email: one.email ?? "", name: one.name ?? "", stop: one.stop, stopLabel: STOP_LABELS[one.stop], pending: one.status === "pending", since: deps.formatWhen(one.confirmedAt ?? one.createdAt), client: client ? { id: client.id, name: client.name } : null };
    }),
    issues: deps.issues.list().map((issue) => ({ id: issue.id, subject: issue.subject, audience: audienceText(issue.stops), status: STATUS_TEXT[issue.status], when: issue.finishedAt ? deps.formatWhen(issue.finishedAt) : issue.startedAt ? deps.formatWhen(issue.startedAt) : "" })),
    stops: stopOptions(),
  });
}

/** Moves someone to another stop, so they get the issues meant for it. */
export function changeSubscriberStop(deps: NewsletterDeps, actorId: Id | null, id: Id, typed: string): Result<Subscriber, Refused | "invalid-stop"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  if (!isStop(typed)) return err("invalid-stop");
  return deps.transact(() => {
    const found = deps.subscribers.get(id);
    if (!found || found.status === "unsubscribed") return err("not-found");
    const changed: Subscriber = { ...found, stop: typed };
    deps.subscribers.save(changed, deps.clock());
    recordActivity(deps, { actorId, action: "newsletter-subscriber.stop-changed", recordType: "newsletter-subscriber", recordId: id, context: { from: found.stop, to: typed } });
    return ok(changed);
  });
}

/** Takes someone off the list and forgets them entirely, as when they ask by phone. */
export function forgetSubscriber(deps: NewsletterDeps, actorId: Id | null, id: Id): Result<null, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const found = deps.subscribers.get(id);
    if (!found) return err("not-found");
    deps.subscribers.remove(id);
    recordActivity(deps, { actorId, action: "newsletter-subscriber.forgotten", recordType: "newsletter-subscriber", recordId: id, context: { stop: found.stop } });
    return ok(null);
  });
}

export type IssueInput = { readonly subject: string; readonly body: string; readonly stops: readonly string[] };

export function addIssue(deps: NewsletterDeps, actorId: Id | null, input: IssueInput): Result<Issue, "forbidden" | IssueError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const fields = issueFields(input);
  if (!fields.ok) return fields;
  return deps.transact(() => {
    const issue: Issue = { id: deps.newId(), ...fields.value, status: "draft", createdBy: actorId, startedAt: null, finishedAt: null };
    deps.issues.insert(issue, deps.clock());
    recordActivity(deps, { actorId, action: "newsletter-issue.created", recordType: "newsletter-issue", recordId: issue.id, context: { subject: issue.subject } });
    return ok(issue);
  });
}

export function editIssue(deps: NewsletterDeps, actorId: Id | null, id: Id, input: IssueInput): Result<Issue, Refused | IssueError | "already-sent"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const fields = issueFields(input);
  if (!fields.ok) return fields;
  return deps.transact(() => {
    const found = deps.issues.get(id);
    if (!found) return err("not-found");
    if (found.status !== "draft") return err("already-sent");
    const changed: Issue = { ...found, ...fields.value };
    deps.issues.save(changed, deps.clock());
    recordActivity(deps, { actorId, action: "newsletter-issue.edited", recordType: "newsletter-issue", recordId: id, context: { subject: changed.subject } });
    return ok(changed);
  });
}

export function removeIssue(deps: NewsletterDeps, actorId: Id | null, id: Id): Result<null, Refused | "already-sent"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const found = deps.issues.get(id);
    if (!found) return err("not-found");
    if (found.status !== "draft") return err("already-sent");
    deps.issues.remove(id);
    recordActivity(deps, { actorId, action: "newsletter-issue.removed", recordType: "newsletter-issue", recordId: id, context: { subject: found.subject } });
    return ok(null);
  });
}

export type IssueView = {
  readonly id: string;
  readonly subject: string;
  readonly body: string;
  readonly stops: readonly Stop[];
  readonly audience: string;
  readonly draft: boolean;
  readonly status: string;
  /** How many it would go to now, for a draft; how many it went to, once sending. */
  readonly reach: number;
  readonly sent: number;
  readonly failed: number;
  readonly waiting: number;
  readonly started: string;
  readonly finished: string;
  readonly stopOptions: readonly { readonly value: Stop; readonly label: string; readonly checked: boolean }[];
};

export function issueDetail(deps: NewsletterDeps, actorId: Id | null, id: Id): Result<IssueView, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const issue = deps.issues.get(id);
  if (!issue) return err("not-found");
  const counts = deps.sends.counts(id);
  const draft = issue.status === "draft";
  return ok({
    id: issue.id,
    subject: issue.subject,
    body: issue.body,
    stops: issue.stops,
    audience: audienceText(issue.stops),
    draft,
    status: STATUS_TEXT[issue.status],
    reach: draft ? deps.subscribers.subscribedIn(issue.stops).length : counts.pending + counts.sent + counts.failed + counts.skipped,
    sent: counts.sent,
    failed: counts.failed,
    waiting: counts.pending,
    started: issue.startedAt ? deps.formatWhen(issue.startedAt) : "",
    finished: issue.finishedAt ? deps.formatWhen(issue.finishedAt) : "",
    stopOptions: STOPS.map((value) => ({ value, label: STOP_LABELS[value], checked: issue.stops.includes(value) })),
  });
}

export type FooterOptions = { readonly publicUrl: string; readonly address: string };
const unsubscribeUrl = (options: FooterOptions, token: string) => `${options.publicUrl}/river/unsubscribe?t=${token}`;
const oneClickUrl = (options: FooterOptions, token: string) => `${options.publicUrl}/river/one-click?t=${token}`;

/** The issue as its readers will get it, emailed to the person asking. Its unsubscribe link goes nowhere. */
export function testIssue(deps: NewsletterDeps, actorId: Id | null, id: Id, options: FooterOptions): Result<{ readonly to: string; readonly subject: string; readonly body: string }, Refused | "no-address"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  if (!options.address) return err("no-address");
  const issue = deps.issues.get(id);
  const me = deps.users.get(actorId);
  if (!issue || !me) return err("not-found");
  const mail = issueEmail(issue, { unsubscribeUrl: unsubscribeUrl(options, "test"), address: options.address });
  return ok({ to: me.email, subject: `[Test] ${mail.subject}`, body: mail.body });
}

/**
 * Starts sending an issue to everyone in its audience who is on the list now.
 * The emails go out in the background (`sendDueIssues`). Needs Potomac's
 * mailing address, which every issue carries.
 */
export function sendIssue(deps: NewsletterDeps, actorId: Id | null, id: Id, options: { readonly address: string; readonly emailOn: boolean }): Result<{ readonly reach: number }, Refused | "already-sent" | "no-address" | "no-one" | "email-off"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  if (!options.emailOn) return err("email-off");
  if (!options.address) return err("no-address");
  return deps.transact(() => {
    const issue = deps.issues.get(id);
    if (!issue) return err("not-found");
    if (issue.status !== "draft") return err("already-sent");
    const readers = deps.subscribers.subscribedIn(issue.stops).filter((one) => inAudience(issue.stops, one));
    if (readers.length === 0) return err("no-one");
    const at = deps.clock();
    deps.issues.save({ ...issue, status: "sending", startedAt: at }, at);
    deps.sends.addAll(issue.id, readers.map((one) => one.id), at);
    recordActivity(deps, { actorId, action: "newsletter-issue.sent", recordType: "newsletter-issue", recordId: id, context: { subject: issue.subject, reach: readers.length } });
    return ok({ reach: readers.length });
  });
}

/**
 * Sends the next batch of every issue going out. Each send is marked before
 * the next begins, so a restart never sends anyone the same issue twice.
 * Someone who left since the issue started is skipped. A send that fails is
 * not tried again: a second copy is worse than a missing one.
 */
export async function sendDueIssues(deps: NewsletterDeps, mail: NewsletterMail, options: FooterOptions, perRun = SENDS_PER_MINUTE): Promise<{ readonly sent: number; readonly failed: number }> {
  let sent = 0;
  let failed = 0;
  let budget = perRun;
  for (const issue of deps.issues.sending()) {
    if (budget <= 0) break;
    for (const subscriberId of deps.sends.pending(issue.id, budget)) {
      budget--;
      const reader = deps.subscribers.get(subscriberId);
      const token = reader ? deps.subscribers.unsubscribeTokenOf(reader.id) : null;
      if (!reader || reader.status !== "subscribed" || !reader.email || !token) {
        deps.sends.mark(issue.id, subscriberId, "skipped", deps.clock());
        continue;
      }
      const message = issueEmail(issue, { unsubscribeUrl: unsubscribeUrl(options, token), address: options.address });
      let delivered = false;
      try {
        delivered = await mail({ to: reader.email, ...message, headers: { "List-Unsubscribe": `<${oneClickUrl(options, token)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
      } catch {
        delivered = false;
      }
      deps.sends.mark(issue.id, subscriberId, delivered ? "sent" : "failed", deps.clock());
      if (delivered) sent++;
      else failed++;
    }
    const counts = deps.sends.counts(issue.id);
    if (counts.pending === 0) {
      deps.transact(() => {
        const at = deps.clock();
        deps.issues.save({ ...issue, status: "sent", finishedAt: at }, at);
        recordActivity(deps, { actorId: null, action: "newsletter-issue.finished", recordType: "newsletter-issue", recordId: issue.id, context: { subject: issue.subject, sent: counts.sent, failed: counts.failed, skipped: counts.skipped } });
      });
    }
  }
  return { sent, failed };
}

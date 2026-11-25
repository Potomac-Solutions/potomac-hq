// Social media (decision 0011): set a client's plan, write the month's posts
// and blog posts, send them to the client, record their yes or their asks,
// and put them up. Permissions: `social.view` to see, `social.edit` to change.
// A client acts only on their own organization's posts, taken from their
// portal session and from nothing they send.
import {
  approvalIsDue,
  approved,
  approvesBy,
  changesAsked,
  dueToPost,
  editPost,
  inMonth,
  monthCount,
  monthName,
  monthOf,
  newPost,
  posted,
  readMonth,
  readPlan,
  sent,
  shiftMonth,
  skipped,
  wordsLimit,
  INSTAGRAM_WORDS,
  NETWORK_LABELS,
  NETWORKS,
  POST_WORDS,
  STATUS_LABELS,
  type ChangeError,
  type Network,
  type PlanError,
  type PlanInput,
  type PostError,
  type PostInput,
  type SocialPlan,
  type SocialPost,
} from "../domain/social.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { dueText, err, friendlyDay, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { ClientNames, SocialStore } from "./ports.ts";

export type SocialDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly social: SocialStore;
  readonly clientName: ClientNames;
  readonly today: () => string;
  /** The business's time zone: when a post was approved is a day there. */
  readonly timeZone: string;
};

/** A client signed in to the portal. The same shape as the portal's session. */
export type SocialClient = { readonly clientUserId: Id; readonly organizationId: Id; readonly name: string };

type Refused = "forbidden" | "not-found";
const may = (deps: SocialDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

function event(deps: SocialDeps, actorId: Id | null, action: string, recordType: string, recordId: Id, context: Record<string, string | number | boolean>): void {
  recordActivity(deps, { actorId, action, recordType, recordId, context });
}

// ---------------------------------------------------------------- the plan

/** Sets a client's plan: makes it the first time, changes it after. Permission: `social.edit`. */
export function setPlan(deps: SocialDeps, actorId: Id | null, organizationId: Id, input: PlanInput): Result<SocialPlan, Refused | PlanError> {
  if (!may(deps, actorId, "social.edit")) return err("forbidden");
  return deps.transact(() => {
    if (deps.clientName(organizationId) === null) return err("not-found");
    const existing = deps.social.planFor(organizationId);
    const made = readPlan({ id: existing?.id ?? deps.newId(), organizationId }, input);
    if (!made.ok) return made;
    if (existing) deps.social.updatePlan(made.value, deps.clock());
    else deps.social.insertPlan(made.value, deps.clock());
    event(deps, actorId, "social-plan.set", "social-plan", made.value.id, { organizationId, networks: made.value.pages.map((one) => one.network).join(","), postsPerMonth: made.value.postsPerMonth, blogsPerMonth: made.value.blogsPerMonth, paused: made.value.paused, first: !existing });
    return ok(made.value);
  });
}

// ---------------------------------------------------------------- writing

/** A new draft on the client's calendar. Needs a plan. Permission: `social.edit`. */
export function writePost(deps: SocialDeps, actorId: Id | null, organizationId: Id, input: PostInput): Result<SocialPost, Refused | PostError | "no-plan"> {
  if (!may(deps, actorId, "social.edit")) return err("forbidden");
  return deps.transact(() => {
    if (deps.clientName(organizationId) === null) return err("not-found");
    const plan = deps.social.planFor(organizationId);
    if (!plan) return err("no-plan");
    const made = newPost({ id: deps.newId(), organizationId }, plan, input);
    if (!made.ok) return made;
    deps.social.insertPost(made.value, actorId, deps.clock());
    event(deps, actorId, "social-post.written", "social-post", made.value.id, { organizationId, kind: made.value.kind, day: made.value.day });
    return ok(made.value);
  });
}

/** Rewrites a post. One the client has seen goes back to a draft. Permission: `social.edit`. */
export function changePost(deps: SocialDeps, actorId: Id | null, id: Id, input: Omit<PostInput, "kind">): Result<SocialPost, Refused | PostError | "already-up"> {
  if (!may(deps, actorId, "social.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.social.post(id);
    const plan = found ? deps.social.planFor(found.organizationId) : null;
    if (!found || !plan) return err("not-found");
    const next = editPost(found, plan, { ...input, kind: found.kind });
    if (!next.ok) return next;
    deps.social.updatePost(next.value, deps.clock());
    event(deps, actorId, "social-post.edited", "social-post", id, { organizationId: found.organizationId, was: found.status, day: next.value.day });
    return ok(next.value);
  });
}

/** Takes a post off the calendar. Not one that's up. Permission: `social.edit`. */
export function removePost(deps: SocialDeps, actorId: Id | null, id: Id): Result<SocialPost, Refused | "already-up"> {
  if (!may(deps, actorId, "social.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.social.post(id);
    if (!found) return err("not-found");
    if (found.status === "posted") return err("already-up");
    deps.social.removePost(id);
    event(deps, actorId, "social-post.removed", "social-post", id, { organizationId: found.organizationId, kind: found.kind, day: found.day, was: found.status });
    return ok(found);
  });
}

// ---------------------------------------------------------------- the client's yes

/**
 * Sends every draft in a client's month to them to approve. Stops at the
 * first that can't go (an Instagram post with no picture) and sends none.
 * Permission: `social.edit`.
 */
export function sendMonth(deps: SocialDeps, actorId: Id | null, organizationId: Id, month: string): Result<number, Refused | ChangeError> {
  if (!may(deps, actorId, "social.edit")) return err("forbidden");
  return deps.transact(() => {
    if (!deps.social.planFor(organizationId)) return err("not-found");
    const at = deps.clock();
    const drafts = deps.social.month(organizationId, month).filter((one) => one.status === "draft");
    if (drafts.length === 0) return err("nothing-to-send");
    const ready: SocialPost[] = [];
    for (const draft of drafts) {
      const out = sent(draft, at);
      if (!out.ok) return out;
      ready.push(out.value);
    }
    for (const one of ready) deps.social.updatePost(one, at);
    event(deps, actorId, "social-post.sent", "social-month", organizationId, { organizationId, month, count: ready.length });
    return ok(ready.length);
  });
}

/** Records the client's yes, given by phone or text, on every post sent in the month. Permission: `social.edit`. */
export function recordApproval(deps: SocialDeps, actorId: Id | null, organizationId: Id, month: string, how: string): Result<number, Refused | ChangeError> {
  if (!may(deps, actorId, "social.edit")) return err("forbidden");
  return deps.transact(() => {
    const at = deps.clock();
    const waiting = deps.social.month(organizationId, month).filter((one) => one.status === "sent");
    if (waiting.length === 0) return err("not-sent");
    const done: SocialPost[] = [];
    for (const one of waiting) {
      const yes = approved(one, "staff", at, how);
      if (!yes.ok) return yes;
      done.push(yes.value);
    }
    for (const one of done) deps.social.updatePost(one, at);
    event(deps, actorId, "social-post.approved", "social-month", organizationId, { organizationId, month, count: done.length, by: "staff" });
    return ok(done.length);
  });
}

/** The client approves every post they were sent in a month, except those they asked to change. */
export function approveMonth(deps: SocialDeps, client: SocialClient | null, month: string): Result<number, "not-found" | "not-sent"> {
  if (!client) return err("not-found");
  return deps.transact(() => {
    const at = deps.clock();
    const waiting = deps.social.month(client.organizationId, month).filter((one) => one.status === "sent");
    if (waiting.length === 0) return err("not-sent");
    for (const one of waiting) {
      const yes = approved(one, "client", at);
      if (yes.ok) deps.social.updatePost(yes.value, at);
    }
    recordActivity(deps, { actorId: null, action: "social-post.approved", recordType: "social-month", recordId: client.organizationId, context: { organizationId: client.organizationId, month, count: waiting.length, by: "client", clientUserId: client.clientUserId } });
    return ok(waiting.length);
  });
}

/** The client asks for a change to one post they were sent. */
export function askForChanges(deps: SocialDeps, client: SocialClient | null, id: Id, note: string): Result<SocialPost, "not-found" | ChangeError> {
  if (!client) return err("not-found");
  return deps.transact(() => {
    const found = deps.social.post(id);
    // Another client's post, or none: the same answer.
    if (!found || found.organizationId !== client.organizationId) return err("not-found");
    const next = changesAsked(found, note);
    if (!next.ok) return next;
    deps.social.updatePost(next.value, deps.clock());
    recordActivity(deps, { actorId: null, action: "social-post.changes-asked", recordType: "social-post", recordId: id, context: { organizationId: client.organizationId, day: found.day, clientUserId: client.clientUserId } });
    return ok(next.value);
  });
}

/** Approves every post sent three days ago with no answer. Run every hour. Returns how many. */
export function approveQuietPosts(deps: SocialDeps): number {
  return deps.transact(() => {
    const now = deps.clock();
    let count = 0;
    for (const one of deps.social.withStatus("sent")) {
      if (!approvalIsDue(one, now)) continue;
      const yes = approved(one, "auto", now);
      if (!yes.ok) continue;
      deps.social.updatePost(yes.value, now);
      recordActivity(deps, { actorId: null, action: "social-post.approved", recordType: "social-post", recordId: one.id, context: { organizationId: one.organizationId, day: one.day, by: "auto" } });
      count += 1;
    }
    return count;
  });
}

// ---------------------------------------------------------------- putting it up

/** It's up, with where. Permission: `social.edit`. */
export function markPosted(deps: SocialDeps, actorId: Id | null, id: Id, links: Readonly<Record<string, string>>): Result<SocialPost, Refused | ChangeError> {
  if (!may(deps, actorId, "social.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.social.post(id);
    if (!found) return err("not-found");
    const next = posted(found, links, deps.clock());
    if (!next.ok) return next;
    deps.social.updatePost(next.value, deps.clock());
    event(deps, actorId, "social-post.posted", "social-post", id, { organizationId: found.organizationId, day: found.day, links: Object.keys(next.value.postedLinks).length });
    return ok(next.value);
  });
}

/** It isn't going up, and why. Permission: `social.edit`. */
export function skipPost(deps: SocialDeps, actorId: Id | null, id: Id, reason: string): Result<SocialPost, Refused | ChangeError> {
  if (!may(deps, actorId, "social.edit")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.social.post(id);
    if (!found) return err("not-found");
    const next = skipped(found, reason);
    if (!next.ok) return next;
    deps.social.updatePost(next.value, deps.clock());
    event(deps, actorId, "social-post.skipped", "social-post", id, { organizationId: found.organizationId, day: found.day });
    return ok(next.value);
  });
}

// ---------------------------------------------------------------- views

const longDay = (day: string) => Temporal.PlainDate.from(day).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });
const longInstantDay = (instant: string, timeZone: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDate().toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" });

export type PlanView = {
  readonly id: string;
  /** Each network, with the client's page there and where "Open" goes: the page, or the network's home when it isn't set. */
  readonly pages: readonly { readonly network: Network; readonly label: string; readonly pageUrl: string; readonly openUrl: string }[];
  readonly postsPerMonth: number;
  readonly blogsPerMonth: number;
  readonly about: string;
  readonly paused: boolean;
  /** "Facebook and Instagram, 8 posts and 1 blog post a month". */
  readonly summary: string;
};

const NETWORK_HOMES: Readonly<Record<Network, string>> = { facebook: "https://www.facebook.com/", instagram: "https://www.instagram.com/", linkedin: "https://www.linkedin.com/" };

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function planView(plan: SocialPlan): PlanView {
  const pages = plan.pages.map((one) => ({ network: one.network, label: NETWORK_LABELS[one.network], pageUrl: one.pageUrl, openUrl: one.pageUrl || NETWORK_HOMES[one.network] }));
  const counts = [`${plan.postsPerMonth} ${plan.postsPerMonth === 1 ? "post" : "posts"}`];
  if (plan.blogsPerMonth > 0) counts.push(`${plan.blogsPerMonth} ${plan.blogsPerMonth === 1 ? "blog post" : "blog posts"}`);
  return { id: plan.id, pages, postsPerMonth: plan.postsPerMonth, blogsPerMonth: plan.blogsPerMonth, about: plan.about, paused: plan.paused, summary: `${listWords(pages.map((one) => one.label))}, ${listWords(counts)} a month` };
}

export type PostLine = {
  readonly id: string;
  readonly kind: "post" | "blog";
  readonly kindLabel: string;
  readonly day: string;
  readonly dayText: string;
  readonly networks: readonly Network[];
  readonly where: string;
  readonly title: string;
  readonly words: string;
  readonly link: string;
  readonly picture: string;
  readonly status: SocialPost["status"];
  readonly statusLabel: string;
  readonly tone: "neutral" | "primary" | "warning" | "success" | "danger";
  /** Who said yes and how, in a sentence. Empty until approved. */
  readonly approval: string;
  readonly clientNote: string;
  readonly postedLinks: readonly { readonly label: string; readonly url: string }[];
  readonly skipReason: string;
  /** Approved, and its day is today or past. */
  readonly due: boolean;
  readonly canChange: boolean;
  /** The plan's networks, each ticked when this post goes there: for its edit form. */
  readonly choices: readonly { readonly value: Network; readonly label: string; readonly checked: boolean }[];
  readonly limit: number;
  /** Where it goes up, for its "It's up" links: each network, or the blog. */
  readonly places: readonly { readonly value: string; readonly label: string }[];
  /** "Open Facebook" and the rest, once it's approved: the client's page on each network it goes to. */
  readonly opens: readonly { readonly label: string; readonly url: string }[];
  /** The words to copy: a blog post's title, then the post. */
  readonly copyText: string;
};

const TONES: Readonly<Record<SocialPost["status"], PostLine["tone"]>> = { draft: "neutral", sent: "primary", changes: "warning", approved: "success", posted: "success", skipped: "neutral" };

function approvalText(post: SocialPost, zone: string): string {
  if (!post.approvedAt || !post.approvedBy) return "";
  const when = longInstantDay(post.approvedAt, zone);
  if (post.approvedBy === "client") return `Approved by the client in their portal, ${when}.`;
  if (post.approvedBy === "auto") return `Approved: no changes asked in 3 days (${when}).`;
  return `Approved for the client, ${when}: ${post.approvalNote}`;
}

function lineOf(post: SocialPost, plan: SocialPlan | null, today: string, zone: string): PostLine {
  const planned = plan ? plan.pages.map((one) => one.network) : [];
  const offered = NETWORKS.filter((one) => planned.includes(one) || post.networks.includes(one));
  return {
    id: post.id,
    kind: post.kind,
    kindLabel: post.kind === "blog" ? "Blog post" : "Post",
    day: post.day,
    dayText: friendlyDay(post.day, today),
    networks: post.networks,
    where: post.kind === "blog" ? "The blog" : listWords(post.networks.map((one) => NETWORK_LABELS[one])),
    title: post.title,
    words: post.words,
    link: post.link ?? "",
    picture: post.picture,
    status: post.status,
    statusLabel: STATUS_LABELS[post.status],
    tone: TONES[post.status],
    approval: approvalText(post, zone),
    clientNote: post.clientNote,
    postedLinks: Object.entries(post.postedLinks).map(([place, url]) => ({ label: place === "blog" ? "The blog" : NETWORK_LABELS[place as Network] ?? place, url })),
    skipReason: post.skipReason,
    due: dueToPost(post, today),
    canChange: post.status !== "posted" && post.status !== "skipped",
    choices: offered.map((one) => ({ value: one, label: NETWORK_LABELS[one], checked: post.networks.includes(one) })),
    limit: wordsLimit(post.kind, post.networks),
    places: post.kind === "blog" ? [{ value: "blog", label: "the blog" }] : post.networks.map((one) => ({ value: one, label: NETWORK_LABELS[one] })),
    opens: post.status === "approved" ? post.networks.map((one) => ({ label: NETWORK_LABELS[one], url: plan?.pages.find((page) => page.network === one)?.pageUrl || NETWORK_HOMES[one] })) : [],
    copyText: post.kind === "blog" ? `${post.title}\n\n${post.words}` : post.words,
  };
}

export type ClientSocialView = {
  readonly client: { readonly id: string; readonly name: string };
  readonly plan: PlanView | null;
  /** Every network, each ticked when the plan has it: for the plan's form. */
  readonly planChoices: readonly { readonly value: Network; readonly label: string; readonly checked: boolean; readonly pageUrl: string }[];
  readonly month: string;
  readonly monthName: string;
  readonly previous: string;
  readonly next: string;
  readonly count: { readonly text: string; readonly over: string };
  readonly posts: readonly PostLine[];
  readonly drafts: number;
  readonly waiting: number;
  readonly changes: number;
  /** "If we don't hear by …": when the oldest post with the client counts as approved. */
  readonly approvesBy: string;
  /** The first and last day of the month, for the day field. */
  readonly firstDay: string;
  readonly lastDay: string;
  /** A day to suggest for a new post: today when it's in the month, else the first. */
  readonly suggestDay: string;
  readonly canEdit: boolean;
  /** What the words field says about its limits. */
  readonly wordsHelp: string;
};

/** A client's plan and one month's calendar. Permission: `social.view`. */
export function clientSocial(deps: SocialDeps, actorId: Id | null, organizationId: Id, monthText: string | null): Result<ClientSocialView, Refused> {
  if (!may(deps, actorId, "social.view")) return err("forbidden");
  const name = deps.clientName(organizationId);
  if (name === null) return err("not-found");
  const today = deps.today();
  const month = readMonth(monthText, today);
  const plan = deps.social.planFor(organizationId);
  const posts = deps.social.month(organizationId, month);
  const first = Temporal.PlainYearMonth.from(month).toPlainDate({ day: 1 });
  const last = first.add({ months: 1 }).subtract({ days: 1 });
  const count = plan ? monthCount(plan, posts) : { text: "", over: "" };
  const waiting = posts.filter((one) => one.status === "sent");
  const oldest = waiting.map((one) => approvesBy(one)).filter((one): one is string => one !== null).sort()[0];
  return ok({
    client: { id: organizationId, name },
    plan: plan ? planView(plan) : null,
    planChoices: NETWORKS.map((one) => ({ value: one, label: NETWORK_LABELS[one], checked: plan ? plan.pages.some((page) => page.network === one) : one !== "linkedin", pageUrl: plan?.pages.find((page) => page.network === one)?.pageUrl ?? "" })),
    month,
    monthName: monthName(month),
    previous: shiftMonth(month, -1),
    next: shiftMonth(month, 1),
    count: { text: count.text, over: count.over },
    posts: posts.map((one) => lineOf(one, plan, today, deps.timeZone)),
    drafts: posts.filter((one) => one.status === "draft").length,
    waiting: waiting.length,
    changes: posts.filter((one) => one.status === "changes").length,
    approvesBy: oldest ? longInstantDay(oldest, deps.timeZone) : "",
    firstDay: first.toString(),
    lastDay: last.toString(),
    suggestDay: inMonth(today, month) ? today : first.toString(),
    canEdit: may(deps, actorId, "social.edit"),
    wordsHelp: `Up to ${INSTAGRAM_WORDS.toLocaleString("en-US")} characters with Instagram, ${POST_WORDS.toLocaleString("en-US")} without`,
  });
}

export type SocialOverviewLine = {
  readonly organizationId: string;
  readonly clientName: string;
  readonly summary: string;
  readonly paused: boolean;
  readonly count: string;
  readonly over: string;
  /** "2 drafts, 3 with the client, 1 to change, 2 to put up". Empty when nothing needs doing. */
  readonly state: string;
  readonly short: boolean;
};

export type SocialOverview = { readonly month: string; readonly monthName: string; readonly previous: string; readonly next: string; readonly clients: readonly SocialOverviewLine[] };

/** Every client with a plan, and where their month stands. Permission: `social.view`. */
export function socialOverview(deps: SocialDeps, actorId: Id | null, monthText: string | null): Result<SocialOverview, "forbidden"> {
  if (!may(deps, actorId, "social.view")) return err("forbidden");
  const today = deps.today();
  const month = readMonth(monthText, today);
  const all = deps.social.everyonesMonth(month);
  const clients = deps.social
    .plans()
    .map((plan) => {
      const posts = all.filter((one) => one.organizationId === plan.organizationId);
      const count = monthCount(plan, posts);
      const n = (status: SocialPost["status"]) => posts.filter((one) => one.status === status).length;
      const due = posts.filter((one) => dueToPost(one, today)).length;
      const parts = [n("draft") && `${n("draft")} ${n("draft") === 1 ? "draft" : "drafts"}`, n("sent") && `${n("sent")} with the client`, n("changes") && `${n("changes")} to change`, due && `${due} to put up`].filter((one): one is string => Boolean(one));
      return {
        organizationId: plan.organizationId,
        clientName: deps.clientName(plan.organizationId) ?? "A removed client",
        summary: planView(plan).summary,
        paused: plan.paused,
        count: count.text,
        over: count.over,
        state: parts.join(", "),
        short: !plan.paused && (count.posts < plan.postsPerMonth || count.blogs < plan.blogsPerMonth),
      };
    })
    .sort((a, b) => Number(a.paused) - Number(b.paused) || a.clientName.localeCompare(b.clientName));
  return ok({ month, monthName: monthName(month), previous: shiftMonth(month, -1), next: shiftMonth(month, 1), clients });
}

/** A line for the client's page: the plan in a sentence and this month's count. Null without `social.view`. */
export function clientSocialSummary(deps: SocialDeps, actorId: Id | null, organizationId: Id): { readonly plan: string; readonly count: string; readonly paused: boolean; readonly canEdit: boolean } | null {
  if (!may(deps, actorId, "social.view")) return null;
  const plan = deps.social.planFor(organizationId);
  const canEdit = may(deps, actorId, "social.edit");
  if (!plan) return { plan: "", count: "", paused: false, canEdit };
  const month = monthOf(deps.today());
  return { plan: planView(plan).summary, count: monthCount(plan, deps.social.month(organizationId, month)).text, paused: plan.paused, canEdit };
}

export type SocialAgendaLine = { readonly id: string; readonly organizationId: string; readonly clientName: string; readonly text: string; readonly detail: string; readonly day: string; readonly overdue: boolean; readonly kind: "to-post" | "changes" };

/**
 * For Today: approved posts due today or earlier that aren't up, and posts
 * the client asked to change. Plans that are paused are left out. Empty
 * without `social.edit`, since only those who can act need to see them.
 */
export function socialToDo(deps: SocialDeps, actorId: Id | null): readonly SocialAgendaLine[] {
  if (!may(deps, actorId, "social.edit")) return [];
  const today = deps.today();
  const active = new Set(deps.social.plans().filter((one) => !one.paused).map((one) => one.organizationId));
  const clientName = (id: Id) => deps.clientName(id) ?? "A removed client";
  const toPost = deps.social
    .withStatus("approved")
    .filter((one) => active.has(one.organizationId) && dueToPost(one, today))
    .map((one) => ({ id: one.id, organizationId: one.organizationId, clientName: clientName(one.organizationId), text: `Put up ${one.kind === "blog" ? `the blog post “${one.title}”` : `a post on ${listWords(one.networks.map((n) => NETWORK_LABELS[n]))}`}`, detail: `${clientName(one.organizationId)} · ${dueText(one.day, today)}`, day: one.day, overdue: one.day < today, kind: "to-post" as const }));
  const changes = deps.social
    .withStatus("changes")
    .filter((one) => active.has(one.organizationId))
    .map((one) => ({ id: one.id, organizationId: one.organizationId, clientName: clientName(one.organizationId), text: `${clientName(one.organizationId)} asked for a change to a post`, detail: `For ${friendlyDay(one.day, today)}: ${one.clientNote}`, day: one.day, overdue: false, kind: "changes" as const }));
  return [...changes, ...toPost];
}

// ---------------------------------------------------------------- the client's portal

export type PortalPostLine = {
  readonly id: string;
  readonly kindLabel: string;
  readonly dayText: string;
  readonly where: string;
  readonly title: string;
  readonly words: string;
  readonly link: string;
  readonly picture: string;
  readonly status: "sent" | "changes" | "approved" | "posted";
  readonly statusLabel: string;
  readonly clientNote: string;
  readonly postedLinks: readonly { readonly label: string; readonly url: string }[];
};

export type PortalSocialView = {
  readonly month: string;
  readonly monthName: string;
  readonly previous: string;
  readonly next: string;
  readonly summary: string;
  readonly posts: readonly PortalPostLine[];
  readonly waiting: number;
  /** "Friday, December 4": when the posts waiting count as approved. Empty when none wait. */
  readonly approvesBy: string;
};

const PORTAL_LABELS: Readonly<Record<PortalPostLine["status"], string>> = { sent: "Waiting on you", changes: "We’re changing it", approved: "Approved", posted: "Up" };

/**
 * The signed-in client's month: what Potomac sent them, what's approved,
 * and what's up. Drafts and skipped posts are Potomac's own and not shown.
 * Null when they have no plan.
 */
export function portalSocial(deps: SocialDeps, client: SocialClient | null, monthText: string | null): PortalSocialView | null {
  if (!client) return null;
  const plan = deps.social.planFor(client.organizationId);
  if (!plan) return null;
  const today = deps.today();
  const month = readMonth(monthText, today);
  const shown = deps.social.month(client.organizationId, month).filter((one): one is SocialPost & { status: PortalPostLine["status"] } => one.status === "sent" || one.status === "changes" || one.status === "approved" || one.status === "posted");
  const waiting = shown.filter((one) => one.status === "sent");
  const oldest = waiting.map((one) => approvesBy(one)).filter((one): one is string => one !== null).sort()[0];
  return {
    month,
    monthName: monthName(month),
    previous: shiftMonth(month, -1),
    next: shiftMonth(month, 1),
    summary: planView(plan).summary,
    posts: shown.map((one) => {
      const line = lineOf(one, plan, today, deps.timeZone);
      return { id: line.id, kindLabel: line.kindLabel, dayText: longDay(one.day), where: line.where, title: line.title, words: line.words, link: line.link, picture: line.picture, status: one.status, statusLabel: PORTAL_LABELS[one.status], clientNote: line.clientNote, postedLinks: line.postedLinks };
    }),
    waiting: waiting.length,
    approvesBy: oldest ? longInstantDay(oldest, deps.timeZone) : "",
  };
}

/** For the portal's "Waiting on you": one line per month with posts to approve. */
export function portalSocialWaiting(deps: SocialDeps, client: SocialClient | null): readonly { readonly key: string; readonly text: string; readonly detail: string; readonly href: string; readonly action: string }[] {
  if (!client || !deps.social.planFor(client.organizationId)) return [];
  const waiting = deps.social.clientsWithStatus(client.organizationId, "sent");
  const months = [...new Set(waiting.map((one) => monthOf(one.day)))].sort();
  return months.map((month) => {
    const posts = waiting.filter((one) => monthOf(one.day) === month);
    const by = posts.map((one) => approvesBy(one)).filter((one): one is string => one !== null).sort()[0];
    return {
      key: `s-${month}`,
      text: `Approve your posts for ${monthName(month)}`,
      detail: `${posts.length} ${posts.length === 1 ? "post" : "posts"} to look over.${by ? ` If we don’t hear from you by ${longInstantDay(by, deps.timeZone)}, we’ll go ahead.` : ""}`,
      href: `/portal/social?month=${month}`,
      action: "Look them over",
    };
  });
}

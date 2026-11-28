// Social media (decision 0011): a client's plan, and the posts and blog
// posts written for each month, from a draft to the client's yes to up on
// the networks.
import { calendarDate, optionalText, requiredText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const NETWORKS = ["facebook", "instagram", "linkedin"] as const;
export type Network = (typeof NETWORKS)[number];
export const NETWORK_LABELS: Readonly<Record<Network, string>> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" };
export const isNetwork = (value: string): value is Network => (NETWORKS as readonly string[]).includes(value);

/** The plan's allowance unless set otherwise (decision 0011, confirmed): 8 posts and 1 blog post a month. */
export const DEFAULT_POSTS = 8;
export const DEFAULT_BLOGS = 1;
export const MAX_PER_MONTH = 60;
export const ABOUT_MAX = 2000;
/** Instagram's caption limit. */
export const INSTAGRAM_WORDS = 2200;
/** LinkedIn's post limit, the lowest of the other two. */
export const POST_WORDS = 3000;
export const BLOG_WORDS = 20000;
export const TITLE_MAX = 120;
export const PICTURE_MAX = 500;
/** The file service's owner for a post's picture. The trash takes a post's pictures with the post (decision 0023). */
export const PICTURE_OWNER = "social-post";
export const NOTE_MAX = 1000;
/** Days a sent post waits for the client before it counts as approved (decision 0011, confirmed). */
export const APPROVE_AFTER_DAYS = 3;

export type PlanPage = { readonly network: Network; readonly pageUrl: string };

export type SocialPlan = {
  readonly id: Id;
  readonly organizationId: Id;
  /** The networks it covers, in NETWORKS order, each with the client's page there (empty when not known yet). */
  readonly pages: readonly PlanPage[];
  readonly postsPerMonth: number;
  readonly blogsPerMonth: number;
  /** How they talk, what to post about, what to stay away from. */
  readonly about: string;
  readonly paused: boolean;
};

export type PlanInput = {
  readonly networks: readonly string[];
  /** The page address for each network, by network. */
  readonly pages: Readonly<Record<string, string | undefined>>;
  readonly postsPerMonth: string;
  readonly blogsPerMonth: string;
  readonly about?: string | null;
  readonly paused?: boolean;
};

export type PlanError = "no-networks" | "invalid-network" | "invalid-page" | "invalid-count" | "about-too-long";

/** A web address, with https:// added when it was typed without one. Null when it isn't one. */
export function cleanUrl(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 500 || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

function count(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= MAX_PER_MONTH ? value : null;
}

/** A plan from what was typed: a new one, or `existing` changed. */
export function readPlan(ids: { readonly id: Id; readonly organizationId: Id }, input: PlanInput): Result<SocialPlan, PlanError> {
  if (input.networks.some((one) => !isNetwork(one))) return err("invalid-network");
  const chosen = NETWORKS.filter((one) => input.networks.includes(one));
  if (chosen.length === 0) return err("no-networks");
  const pages: PlanPage[] = [];
  for (const network of chosen) {
    const typed = (input.pages[network] ?? "").trim();
    const pageUrl = typed ? cleanUrl(typed) : "";
    if (pageUrl === null) return err("invalid-page");
    pages.push({ network, pageUrl });
  }
  const posts = count(input.postsPerMonth);
  const blogs = count(input.blogsPerMonth);
  if (posts === null || blogs === null || posts + blogs === 0) return err("invalid-count");
  const about = optionalText(input.about, ABOUT_MAX);
  if (!about.ok) return err("about-too-long");
  return ok({ ...ids, pages, postsPerMonth: posts, blogsPerMonth: blogs, about: about.value ?? "", paused: input.paused === true });
}

export const planNetworks = (plan: SocialPlan): readonly Network[] => plan.pages.map((one) => one.network);

export const POST_KINDS = ["post", "blog"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_STATUSES = ["draft", "sent", "changes", "approved", "posted", "skipped"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const STATUS_LABELS: Readonly<Record<PostStatus, string>> = { draft: "Draft", sent: "With the client", changes: "Changes asked", approved: "Approved", posted: "Up", skipped: "Skipped" };
/** The statuses a client sees in their portal: sent to them, asked about, approved, or up. */
export const SHOWN_TO_CLIENT: readonly PostStatus[] = ["sent", "changes", "approved", "posted"];

/** Who said yes: the client in the portal, Potomac recording what the client said, or three days of quiet. */
export type ApprovedBy = "client" | "staff" | "auto";

export type SocialPost = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly kind: PostKind;
  /** The day it goes up. Its month is the calendar it's on. */
  readonly day: string;
  /** Where it goes. Empty for a blog post. */
  readonly networks: readonly Network[];
  /** A blog post's title. Empty for a post. */
  readonly title: string;
  readonly words: string;
  readonly link: string | null;
  /** What the picture shows. */
  readonly picture: string;
  /** The uploaded picture, kept in the file service. Null until one is uploaded. */
  readonly pictureFileId: Id | null;
  readonly status: PostStatus;
  readonly sentAt: string | null;
  readonly approvedAt: string | null;
  readonly approvedBy: ApprovedBy | null;
  /** How the client said yes, when Potomac recorded it: "By text, Tuesday". */
  readonly approvalNote: string;
  /** What the client asked to change. Kept until it's sent again. */
  readonly clientNote: string;
  readonly postedAt: string | null;
  /** Where it went up, by network (or "blog"): links are optional. */
  readonly postedLinks: Readonly<Record<string, string>>;
  readonly skipReason: string;
};

export type PostInput = {
  readonly kind: string;
  readonly day: string;
  readonly networks?: readonly string[];
  readonly title?: string | null;
  readonly words: string;
  readonly link?: string | null;
  readonly picture?: string | null;
};

export type PostError =
  | "invalid-kind"
  | "invalid-date"
  | "no-networks"
  | "network-not-in-plan"
  | "title-missing"
  | "title-too-long"
  | "words-missing"
  | "words-too-long"
  | "instagram-too-long"
  | "invalid-link"
  | "picture-too-long";

/** The words limit for a post going to these networks. */
export const wordsLimit = (kind: PostKind, networks: readonly Network[]): number => (kind === "blog" ? BLOG_WORDS : networks.includes("instagram") ? INSTAGRAM_WORDS : POST_WORDS);

type Written = Pick<SocialPost, "kind" | "day" | "networks" | "title" | "words" | "link" | "picture">;

function readWritten(plan: SocialPlan, input: PostInput): Result<Written, PostError> {
  if (!(POST_KINDS as readonly string[]).includes(input.kind)) return err("invalid-kind");
  const kind = input.kind as PostKind;
  const day = calendarDate(input.day.trim());
  if (!day.ok) return day;
  let networks: Network[] = [];
  let title = "";
  if (kind === "post") {
    const typed = input.networks ?? [];
    if (typed.some((one) => !isNetwork(one))) return err("network-not-in-plan");
    networks = NETWORKS.filter((one) => typed.includes(one));
    if (networks.length === 0) return err("no-networks");
    if (networks.some((one) => !planNetworks(plan).includes(one))) return err("network-not-in-plan");
  } else {
    const named = requiredText(input.title, TITLE_MAX);
    if (!named.ok) return err(named.error === "missing" ? "title-missing" : "title-too-long");
    title = named.value;
  }
  const words = (input.words ?? "").trim();
  if (!words) return err("words-missing");
  if (words.length > wordsLimit(kind, networks)) return err(kind === "post" && networks.includes("instagram") && words.length <= POST_WORDS ? "instagram-too-long" : "words-too-long");
  const typedLink = (input.link ?? "").trim();
  const link = typedLink ? cleanUrl(typedLink) : null;
  if (typedLink && link === null) return err("invalid-link");
  const picture = optionalText(input.picture, PICTURE_MAX);
  if (!picture.ok) return err("picture-too-long");
  return ok({ kind, day: day.value, networks, title, words, link, picture: picture.value ?? "" });
}

/** A new draft on the plan's calendar. */
export function newPost(ids: { readonly id: Id; readonly organizationId: Id }, plan: SocialPlan, input: PostInput): Result<SocialPost, PostError> {
  const written = readWritten(plan, input);
  if (!written.ok) return written;
  return ok({ ...ids, ...written.value, status: "draft", pictureFileId: null, sentAt: null, approvedAt: null, approvedBy: null, approvalNote: "", clientNote: "", postedAt: null, postedLinks: {}, skipReason: "" });
}

export type ChangeError = "already-up" | "not-sent" | "not-approved" | "instagram-needs-picture" | "note-missing" | "note-too-long" | "invalid-link" | "nothing-to-send";

/**
 * The post rewritten. Anything the client has seen goes back to a draft,
 * to be sent to them again; their note stays until it is.
 */
export function editPost(post: SocialPost, plan: SocialPlan, input: PostInput): Result<SocialPost, PostError | "already-up"> {
  if (post.status === "posted" || post.status === "skipped") return err("already-up");
  const written = readWritten(plan, { ...input, kind: post.kind });
  if (!written.ok) return written;
  return ok({ ...post, ...written.value, status: "draft", sentAt: null, approvedAt: null, approvedBy: null, approvalNote: "" });
}

/**
 * The post with its picture changed: a new one, or none. Anything the client
 * has seen goes back to a draft, as an edit does. Not one that's up.
 */
export function pictured(post: SocialPost, fileId: Id | null): Result<SocialPost, "already-up"> {
  if (post.status === "posted" || post.status === "skipped") return err("already-up");
  return ok({ ...post, pictureFileId: fileId, status: "draft", sentAt: null, approvedAt: null, approvedBy: null, approvalNote: "" });
}

/** Sent to the client to approve. A post to Instagram needs its picture uploaded first. */
export function sent(post: SocialPost, at: string): Result<SocialPost, ChangeError> {
  if (post.status !== "draft") return err("nothing-to-send");
  if (post.kind === "post" && post.networks.includes("instagram") && !post.pictureFileId) return err("instagram-needs-picture");
  return ok({ ...post, status: "sent", sentAt: at, clientNote: "" });
}

/** The client, or Potomac for them, said yes. */
export function approved(post: SocialPost, by: ApprovedBy, at: string, note = ""): Result<SocialPost, ChangeError> {
  if (post.status !== "sent") return err("not-sent");
  if (by === "staff") {
    const said = requiredText(note, NOTE_MAX);
    if (!said.ok) return err(said.error === "missing" ? "note-missing" : "note-too-long");
    return ok({ ...post, status: "approved", approvedAt: at, approvedBy: by, approvalNote: said.value });
  }
  return ok({ ...post, status: "approved", approvedAt: at, approvedBy: by, approvalNote: "" });
}

/** The client asked for a change, saying what. */
export function changesAsked(post: SocialPost, note: string): Result<SocialPost, ChangeError> {
  if (post.status !== "sent") return err("not-sent");
  const said = requiredText(note, NOTE_MAX);
  if (!said.ok) return err(said.error === "missing" ? "note-missing" : "note-too-long");
  return ok({ ...post, status: "changes", clientNote: said.value });
}

/** When a sent post counts as approved if the client says nothing. */
export const approvesBy = (post: Pick<SocialPost, "sentAt">): string | null => (post.sentAt ? Temporal.Instant.from(post.sentAt).add({ hours: 24 * APPROVE_AFTER_DAYS }).toString() : null);

/** True when a sent post has waited its three days. */
export function approvalIsDue(post: SocialPost, now: string): boolean {
  const by = approvesBy(post);
  return post.status === "sent" && by !== null && Temporal.Instant.compare(now, by) >= 0;
}

/** Up on the networks, with the links where they're known. */
export function posted(post: SocialPost, links: Readonly<Record<string, string>>, at: string): Result<SocialPost, ChangeError> {
  if (post.status === "posted" || post.status === "skipped") return err("already-up");
  if (post.status !== "approved") return err("not-approved");
  const places = post.kind === "blog" ? ["blog"] : post.networks;
  const kept: Record<string, string> = {};
  for (const place of places) {
    const typed = (links[place] ?? "").trim();
    if (!typed) continue;
    const url = cleanUrl(typed);
    if (url === null) return err("invalid-link");
    kept[place] = url;
  }
  return ok({ ...post, status: "posted", postedAt: at, postedLinks: kept });
}

/** Not going up, and why. */
export function skipped(post: SocialPost, reason: string): Result<SocialPost, ChangeError> {
  if (post.status === "posted" || post.status === "skipped") return err("already-up");
  const said = requiredText(reason, NOTE_MAX);
  if (!said.ok) return err(said.error === "missing" ? "note-missing" : "note-too-long");
  return ok({ ...post, status: "skipped", skipReason: said.value });
}

/** A month as YYYY-MM. */
export const monthOf = (day: string): string => day.slice(0, 7);

export function readMonth(text: string | null | undefined, today: string): string {
  const typed = (text ?? "").trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(typed)) return typed;
  return monthOf(today);
}

export const shiftMonth = (month: string, by: number): string => monthOf(Temporal.PlainYearMonth.from(month).add({ months: by }).toPlainDate({ day: 1 }).toString());

export const monthName = (month: string): string => Temporal.PlainYearMonth.from(month).toPlainDate({ day: 1 }).toLocaleString("en-US", { month: "long", year: "numeric" });

/** True when the day is in the month. */
export const inMonth = (day: string, month: string): boolean => monthOf(day) === month;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type MonthCount = {
  readonly posts: number;
  readonly blogs: number;
  readonly planPosts: number;
  readonly planBlogs: number;
  /** "6 of 8 posts, 0 of 1 blog post". */
  readonly text: string;
  /** "One more post than the plan", or empty. */
  readonly over: string;
};

/** What a month holds against the plan. Skipped posts don't count. */
export function monthCount(plan: Pick<SocialPlan, "postsPerMonth" | "blogsPerMonth">, posts: readonly Pick<SocialPost, "kind" | "status">[]): MonthCount {
  const counting = posts.filter((one) => one.status !== "skipped");
  const made = counting.filter((one) => one.kind === "post").length;
  const blogs = counting.filter((one) => one.kind === "blog").length;
  const parts = [`${made} of ${plural(plan.postsPerMonth, "post", "posts")}`];
  if (plan.blogsPerMonth > 0 || blogs > 0) parts.push(`${blogs} of ${plural(plan.blogsPerMonth, "blog post", "blog posts")}`);
  const extra: string[] = [];
  if (made > plan.postsPerMonth) extra.push(plural(made - plan.postsPerMonth, "post", "posts"));
  if (blogs > plan.blogsPerMonth) extra.push(plural(blogs - plan.blogsPerMonth, "blog post", "blog posts"));
  return { posts: made, blogs, planPosts: plan.postsPerMonth, planBlogs: plan.blogsPerMonth, text: parts.join(", "), over: extra.length ? `${extra.join(" and ")} more than the plan` : "" };
}

/** True when an approved post is due to go up: its day is today or past. */
export const dueToPost = (post: Pick<SocialPost, "status" | "day">, today: string): boolean => post.status === "approved" && Temporal.PlainDate.compare(post.day, today) <= 0;

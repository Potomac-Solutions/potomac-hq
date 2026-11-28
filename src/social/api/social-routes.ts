// Social media's forms (decision 0011). Potomac's people set plans, write,
// send, record a yes and mark posts up; a client approves their month and
// asks for changes in the portal, as who their portal cookie says and
// nothing they send.
import { Hono } from "hono";
import * as social from "../application/social.ts";
import type { SocialClient, SocialDeps } from "../application/social.ts";
import { formPosts, type FormFields, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "no-networks": "Tick at least one network.",
  "invalid-network": "Choose networks from the list.",
  "invalid-page": "Enter each page’s address, like facebook.com/feedstore, or leave it empty.",
  "invalid-count": "Enter how many a month as a number from 0 to 60, with at least one post or blog post.",
  "about-too-long": "Keep what you write about the business under 2,000 characters.",
  "no-plan": "Set the client’s social media plan first.",
  "invalid-kind": "Choose a post or a blog post.",
  "invalid-date": "Enter the day it goes up.",
  "network-not-in-plan": "A post can only go to the plan’s networks. Add the network to the plan first.",
  "title-missing": "Give the blog post a title.",
  "title-too-long": "Keep the title under 120 characters.",
  "words-missing": "Write the post.",
  "words-too-long": "That’s too long: 3,000 characters for a post, 20,000 for a blog post.",
  "instagram-too-long": "Instagram takes up to 2,200 characters. Shorten it, or don’t send it to Instagram.",
  "invalid-link": "Enter the link as a web address, like feedstore.com/winter.",
  "picture-too-long": "Keep what the picture shows under 500 characters.",
  "already-up": "That post is already up or skipped, so it can’t change.",
  "nothing-to-send": "There are no drafts this month to send.",
  "instagram-needs-picture": "An Instagram post needs its picture. Upload the picture on each Instagram post before sending.",
  "no-picture": "This post has no picture to take off.",
  "photo-not-a-photo": "Use a JPEG, PNG or WebP picture.",
  "photo-too-large": "That picture is too big. Try again in a current browser, which shrinks it for you, or send a smaller copy.",
  "file-type-not-allowed": "Use a JPEG, PNG or WebP picture.",
  "file-too-large": "That picture is too big. Try again in a current browser, which shrinks it for you, or send a smaller copy.",
  "file-content-mismatch": "That file isn’t what its name says it is.",
  "file-name-invalid": "Rename the picture file, then try again.",
  "not-sent": "There’s nothing waiting for an answer.",
  "not-approved": "Only an approved post can go up.",
  "note-missing": "Say what to change, or how the client said yes.",
  "note-too-long": "Keep it under 1,000 characters.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

const month = (f: FormFields): string => (/^\d{4}-(0[1-9]|1[0-2])$/.test(f["month"] ?? "") ? (f["month"] as string) : "");
const networks = (f: FormFields): string[] => ["facebook", "instagram", "linkedin"].filter((one) => f[`network-${one}`] === "1");

function postInput(f: FormFields) {
  return { day: f["day"] ?? "", networks: networks(f), title: f["title"] ?? null, words: f["words"] ?? "", link: f["link"] ?? null, picture: f["picture"] ?? null };
}

export type SocialRoutesDeps = {
  readonly social: SocialDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly clientOf: (cookieHeader: string) => SocialClient | null;
  readonly sign: (location: string) => string;
};

/** What Potomac's people post. */
export function socialStaffRoutes(deps: SocialRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/social" });
  /** The client's calendar, at the month the form came from. */
  const calendar = (clientId: string | null, f: FormFields, anchor = "") => {
    const at = month(f);
    const id = clientId ?? (/^[0-9a-f-]{36}$/.test(f["clientId"] ?? "") ? f["clientId"] : null);
    return id ? `/clients/${id}/social${at ? `?month=${at}` : ""}${anchor ? `#${anchor}` : ""}` : "/social";
  };

  post(
    "/clients/:id/social/plan",
    (actor, f, id) => social.setPlan(deps.social, actor, id as Id, { networks: networks(f), pages: { facebook: f["page-facebook"], instagram: f["page-instagram"], linkedin: f["page-linkedin"] }, postsPerMonth: f["postsPerMonth"] ?? "", blogsPerMonth: f["blogsPerMonth"] ?? "", about: f["about"] ?? null, paused: f["paused"] === "1" }),
    { done: (_v, id, f) => calendar(id, f), back: (id, f) => calendar(id, f, "plan"), message: "Plan saved." },
  );
  post(
    "/clients/:id/social/posts",
    (actor, f, id, files) => social.writePost(deps.social, actor, id as Id, { kind: f["kind"] ?? "", ...postInput(f) }, files["picture-file"] ?? null),
    { done: (made, id) => `/clients/${id}/social?month=${made.day.slice(0, 7)}#post-${made.id}`, back: (id, f) => calendar(id, f, "write"), message: (made) => (made.kind === "blog" ? "Blog post added as a draft." : "Post added as a draft.") },
  );
  post(
    "/social/posts/:id",
    (actor, f, id, files) => social.changePost(deps.social, actor, id as Id, postInput(f), files["picture-file"] ?? null),
    { done: (changed, _id, f) => `${calendar(null, { ...f, month: changed.day.slice(0, 7) })}#post-${changed.id}`, back: (id, f) => calendar(null, f, `post-${id}`), message: "Saved as a draft. Send it to the client again when it’s ready." },
  );
  post("/social/posts/:id/remove", (actor, _f, id) => social.removePost(deps.social, actor, id as Id), { done: (_v, _id, f) => calendar(null, f), back: (id, f) => calendar(null, f, `post-${id}`), message: "Removed from the calendar." });
  post(
    "/clients/:id/social/send",
    (actor, f, id) => social.sendMonth(deps.social, actor, id as Id, month(f)),
    { done: (_v, id, f) => calendar(id, f), back: (id, f) => calendar(id, f), message: (n) => `Sent ${n} to the client. It’s in their portal, and counts as approved in 3 days if they say nothing.` },
  );
  post(
    "/clients/:id/social/approve",
    (actor, f, id) => social.recordApproval(deps.social, actor, id as Id, month(f), f["how"] ?? ""),
    { done: (_v, id, f) => calendar(id, f), back: (id, f) => calendar(id, f, "record"), message: (n) => `Recorded: ${n} approved.` },
  );
  post(
    "/social/posts/:id/posted",
    (actor, f, id) => social.markPosted(deps.social, actor, id as Id, { facebook: f["link-facebook"] ?? "", instagram: f["link-instagram"] ?? "", linkedin: f["link-linkedin"] ?? "", blog: f["link-blog"] ?? "" }),
    { done: (_v, id, f) => (f["back"] === "today" ? "/today" : calendar(null, f, `post-${id}`)), back: (id, f) => calendar(null, f, `post-${id}`), message: "Marked up." },
  );
  post("/social/posts/:id/skip", (actor, f, id) => social.skipPost(deps.social, actor, id as Id, f["reason"] ?? ""), { done: (_v, id, f) => calendar(null, f, `post-${id}`), back: (id, f) => calendar(null, f, `post-${id}`), message: "Skipped. It no longer counts toward the plan." });
  post("/social/posts/:id/picture/remove", (actor, _f, id) => social.removePicture(deps.social, actor, id as Id), { done: (_v, _id, f) => calendar(null, f), back: (id, f) => calendar(null, f, `post-${id}`), message: "Picture removed. The post is a draft again." });
  return app;
}

/** What a client posts about their own posts. */
export function socialPortalRoutes(deps: SocialRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts<SocialClient | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor, home: "/portal" });
  const page = (f: FormFields, anchor = "") => `/portal/social${month(f) ? `?month=${month(f)}` : ""}${anchor ? `#${anchor}` : ""}`;
  post("/portal/social/approve", (session, f) => social.approveMonth(deps.social, session, month(f)), { done: (_v, _id, f) => page(f), back: (_id, f) => page(f), message: "Thank you. We’ll put them up on their days." });
  post("/portal/social/posts/:id/changes", (session, f, id) => social.askForChanges(deps.social, session, id as Id, f["note"] ?? ""), { done: (_v, id, f) => page(f, `post-${id}`), back: (id, f) => page(f, `post-${id}`), message: "Sent. We’ll change it and send it back to you." });
  return app;
}

// Website content's forms and photo pictures. The same changes are offered
// in two places: to a client in the portal, about their own site, and to
// Potomac's people in HQ, about any site. A client's routes take who is
// asking from the portal's cookie and from nothing else.
import { Hono } from "hono";
import * as websites from "../application/websites.ts";
import type { ClientEditor, ContentSite, Editor, WebsitesDeps } from "../application/websites.ts";
import { formPosts, parseId, type FormFields, type FormFiles, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "title-missing": "Give the photo a short title.",
  "title-too-long": "Keep the title under 60 characters.",
  "alt-missing": "Say what the photo shows, for someone who can’t see it.",
  "alt-too-long": "Keep what the photo shows under 200 characters.",
  "caption-too-long": "Keep the caption under 200 characters.",
  "notice-too-long": "Keep the notice under 160 characters.",
  "quote-missing": "Enter what the customer said.",
  "quote-too-long": "Keep the review under 700 characters.",
  "by-missing": "Say who the review is from, like Evelyn S.",
  "by-too-long": "Keep who it’s from under 80 characters.",
  "too-many-photos": "The gallery holds up to 30 photos. Remove one first.",
  "too-many-reviews": "The site holds up to 12 reviews. Remove one first.",
  "last-photo": "The gallery needs at least one photo. Add another before removing this one.",
  "no-such-photo": "That photo isn’t in the gallery any more.",
  "no-such-review": "That review isn’t there any more.",
  unchanged: "Nothing changed.",
  "photo-missing": "Choose a photo first.",
  "photo-too-large": "That photo is too big for a web page. Try again in a current browser, which shrinks it for you, or send a smaller copy.",
  "photo-not-a-photo": "That file isn’t a JPEG, PNG or WebP photo.",
  "nothing-to-send": "There are no changes to send.",
  "already-sent": "These changes have already been sent.",
  "nothing-waiting": "There are no changes waiting.",
  "not-sent": "These changes haven’t been sent in, so there is nothing to send back.",
  "note-missing": "Say what should change.",
  "note-too-long": "Keep the note under 1,000 characters.",
  "name-missing": "Give the site a name, like Nu Finish website.",
  "name-too-long": "Keep the name under 80 characters.",
  "repo-invalid": "Enter the repository as owner/name, like Potomac-Solutions/nu-finish-site.",
  "branch-invalid": "That isn’t a branch name.",
  "content-path-invalid": "The content file is a path to a .json file in the repository, like src/content/site.json.",
  "photo-dir-invalid": "The photo folder is a path in the repository, like public/gallery.",
  "already-set-up": "This client’s site is already set up.",
  "repo-in-use": "That repository’s content file is already set up for another client.",
  "changes-waiting": "Changes are waiting. Publish or discard them before reading the site again.",
  "github-not-set-up": "HQ has no GitHub token, so it can’t read or publish sites. Set HQ_GITHUB_TOKEN on the server.",
  "repo-refused": "GitHub refused. Check that HQ’s token may read and write this repository, and that the branch isn’t protected against it.",
  "repo-missing": "GitHub has no such repository, branch or file, or HQ’s token can’t see it. Check all three.",
  "repo-changed": "The site’s repository changed while HQ was publishing. Try again. If a photo was removed there by hand, read the site again first.",
  "repo-failed": "HQ couldn’t reach GitHub. Try again in a minute.",
  "content-invalid": "The site’s content file isn’t in the shape HQ reads: a JSON object with a gallery list of photos.",
  "photo-unreadable": "A photo named in the content file isn’t in the repository where HQ looked. Check the photo folder.",
  "photo-lost": "A new photo’s file is missing in HQ. Remove that photo and add it again.",
  busy: "This site is being published right now. Wait a moment.",
  "mode-invalid": "Choose what visitors see.",
  "opens-invalid": "Enter the day and the time as they are on a calendar and a clock.",
  "opens-time-missing": "Enter the time of day too. Midnight is 12:00 AM.",
  "opens-past": "That time has already passed. Choose a later one, or choose “The website” to open it now.",
  "status-message-too-long": "Keep your line under 200 characters.",
  "address-invalid": "Enter the site’s address, like nufinishcollision.com. It must be an https address.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

const photoInput = (f: FormFields, files: FormFiles) => ({ title: f["title"] ?? "", alt: f["alt"] ?? "", caption: f["caption"] ?? "", bytes: files["photo"]?.bytes ?? null });
const words = (f: FormFields) => ({ title: f["title"] ?? "", alt: f["alt"] ?? "", caption: f["caption"] ?? "" });
const status = (f: FormFields) => ({ mode: f["mode"] ?? "", opensOn: f["opensOn"] ?? "", opensTime: f["opensTime"] ?? "", message: f["message"] ?? "" });
const indexOf = (f: FormFields) => (/^\d{1,3}$/.test(f["index"] ?? "") ? Number(f["index"]) : -1);

export type WebsiteRoutesDeps = {
  readonly websites: WebsitesDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  /** The client a Cookie header is signed in as, or null. */
  readonly clientOf: (cookieHeader: string) => ClientEditor | null;
  readonly sign: (location: string) => string;
};

/** What Potomac's people post: setting a site up, changing it, and publishing. */
export function websiteStaffRoutes(deps: WebsiteRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/websites" });
  const staff = (actorId: Id | null): Editor => ({ kind: "staff", actorId });
  const page = (site: ContentSite, anchor: string) => `/websites/${site.id}#${anchor}`;
  const back = (anchor: string) => (id: Id | null) => (id ? `/websites/${id}#${anchor}` : "/websites");
  /** After a change to a photo, whose address names the photo and not its site. */
  const backToSite = (_: Id | null, f: FormFields) => (parseId(f["siteId"] ?? "").ok ? `/websites/${f["siteId"]}#photos` : "/websites");

  post("/clients/:id/website", (actor, f, id) => websites.setUpSite(deps.websites, actor, id as Id, { name: f["name"] ?? "", repo: f["repo"] ?? "", branch: f["branch"] ?? "", contentPath: f["contentPath"] ?? "", photoDir: f["photoDir"] ?? "", siteUrl: f["siteUrl"] ?? "" }), {
    done: (site) => `/websites/${site.id}`,
    back: (id) => `/clients/${id}#website`,
    message: "Set up. HQ read the site’s photos, notice and reviews. The client can change them in their portal now.",
  });
  post("/websites/:id/read-again", (actor, _f, id) => websites.readSiteAgain(deps.websites, actor, id as Id), { done: (site) => `/websites/${site.id}`, back: back("site"), message: "Read again. This is what is on the site now." });
  post("/websites/:id/photos", (actor, f, id, files) => websites.addPhoto(deps.websites, staff(actor), id as Id, photoInput(f, files)), { done: (site) => page(site, "photos"), back: back("add-photo"), message: "Photo added. It goes on the site when you publish." });
  post("/websites/photos/:id", (actor, f, id) => websites.editPhoto(deps.websites, staff(actor), id as Id, words(f)), { done: (site) => page(site, "photos"), back: backToSite, message: "Saved." });
  post("/websites/photos/:id/remove", (actor, _f, id) => websites.removePhoto(deps.websites, staff(actor), id as Id), { done: (site) => page(site, "photos"), back: backToSite, message: "Photo removed." });
  post("/websites/photos/:id/move", (actor, f, id) => websites.movePhoto(deps.websites, staff(actor), id as Id, f["to"] ?? ""), { done: (site) => page(site, "photos"), back: backToSite, message: "Moved." });
  post("/websites/:id/notice", (actor, f, id) => websites.setNotice(deps.websites, staff(actor), id as Id, f["notice"] ?? ""), { done: (site) => page(site, "notice"), back: back("notice"), message: "Saved." });
  post("/websites/:id/reviews", (actor, f, id) => websites.addReview(deps.websites, staff(actor), id as Id, { quote: f["quote"] ?? "", by: f["by"] ?? "" }), { done: (site) => page(site, "reviews"), back: back("reviews"), message: "Review added." });
  post("/websites/:id/reviews/remove", (actor, f, id) => websites.removeReview(deps.websites, staff(actor), id as Id, indexOf(f)), { done: (site) => page(site, "reviews"), back: back("reviews"), message: "Review removed." });
  post("/websites/:id/discard", (actor, _f, id) => websites.discardChanges(deps.websites, staff(actor), id as Id), { done: (site) => `/websites/${site.id}`, back: back("waiting"), message: "Changes discarded. The site is as it was." });
  post("/websites/:id/send-back", (actor, f, id) => websites.sendChangesBack(deps.websites, actor, id as Id, f["note"] ?? ""), { done: (site) => `/websites/${site.id}`, back: back("waiting"), message: "Sent back. The client sees your note in their portal." });
  post("/websites/:id/status", (actor, f, id) => websites.setSiteStatus(deps.websites, staff(actor), id as Id, status(f)), { done: (site) => page(site, "status"), back: back("status"), message: "Saved. The website updates in a minute or two." });
  post("/websites/:id/preview-link", (actor, _f, id) => websites.newPreviewLink(deps.websites, staff(actor), id as Id), { done: (site) => page(site, "status"), back: back("status"), message: "New preview link made. The old one no longer works." });
  post("/websites/:id/address", (actor, f, id) => websites.setSiteAddress(deps.websites, actor, id as Id, f["siteUrl"] ?? ""), { done: (site) => page(site, "site"), back: back("site"), message: "Saved." });
  post("/websites/:id/publish", (actor, _f, id) => websites.publishChanges(deps.websites, actor, id as Id), { done: (site) => `/websites/${site.id}`, back: back("waiting"), message: "Published. The site rebuilds with the changes in a minute or two." });
  return app;
}

/** What a client posts about their own site. */
export function websitePortalRoutes(deps: WebsiteRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts<ClientEditor | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor, home: "/portal" });
  const client = (session: ClientEditor | null): Editor => ({ kind: "client", session });
  const at = (anchor: string) => () => `/portal/website#${anchor}`;
  const NOT_ON_SITE = " It isn’t on your website until you send your changes.";

  post("/portal/website/photos", (session, f, _id, files) => websites.addPhoto(deps.websites, client(session), null, photoInput(f, files)), { done: at("photos"), back: at("add-photo"), message: `Photo added.${NOT_ON_SITE}` });
  post("/portal/website/photos/:id", (session, f, id) => websites.editPhoto(deps.websites, client(session), id as Id, words(f)), { done: at("photos"), back: at("photos"), message: `Saved.${NOT_ON_SITE}` });
  post("/portal/website/photos/:id/remove", (session, _f, id) => websites.removePhoto(deps.websites, client(session), id as Id), { done: at("photos"), back: at("photos"), message: `Photo removed.${NOT_ON_SITE}` });
  post("/portal/website/photos/:id/move", (session, f, id) => websites.movePhoto(deps.websites, client(session), id as Id, f["to"] ?? ""), { done: at("photos"), back: at("photos"), message: `Moved.${NOT_ON_SITE}` });
  post("/portal/website/notice", (session, f) => websites.setNotice(deps.websites, client(session), null, f["notice"] ?? ""), { done: at("notice"), back: at("notice"), message: `Saved.${NOT_ON_SITE}` });
  post("/portal/website/reviews", (session, f) => websites.addReview(deps.websites, client(session), null, { quote: f["quote"] ?? "", by: f["by"] ?? "" }), { done: at("reviews"), back: at("reviews"), message: `Review added.${NOT_ON_SITE}` });
  post("/portal/website/reviews/remove", (session, f) => websites.removeReview(deps.websites, client(session), null, indexOf(f)), { done: at("reviews"), back: at("reviews"), message: `Review removed.${NOT_ON_SITE}` });
  post("/portal/website/status", (session, f) => websites.setSiteStatus(deps.websites, client(session), null, status(f)), { done: at("status"), back: at("status"), message: "Saved. Your website updates in a minute or two." });
  post("/portal/website/preview-link", (session) => websites.newPreviewLink(deps.websites, client(session), null), { done: at("status"), back: at("status"), message: "New preview link made. The old one no longer works." });
  post("/portal/website/discard", (session) => websites.discardChanges(deps.websites, client(session), null), { done: () => "/portal/website", back: () => "/portal/website", message: "Your changes are undone. Your website is as it was." });
  post("/portal/website/submit", (session) => websites.submitChanges(deps.websites, session), { done: () => "/portal/website", back: () => "/portal/website", message: "Sent to Potomac Solutions. We’ll check your changes and put them on your website." });
  return app;
}

/** A photo, shown in the page. Only to someone who may change the site it belongs to. */
export function websiteDownloads(deps: Pick<WebsiteRoutesDeps, "websites" | "actorOf" | "clientOf">): Hono {
  const app = new Hono();
  const missing = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const send = (editor: Editor, typed: string) => {
    const id = parseId(typed);
    const found = id.ok ? websites.photoFor(deps.websites, editor, id.value) : null;
    if (!found || !found.ok) return missing();
    // A photo's bytes never change under its id, so the browser may keep it. Never run, only shown.
    return new Response(new Uint8Array(found.value.body), { status: 200, headers: { "content-type": found.value.contentType, "content-length": String(found.value.body.length), "cache-control": "private, max-age=86400, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  };
  app.get("/websites/photos/:id", (c) => send({ kind: "staff", actorId: deps.actorOf(c.req.header("cookie") ?? "") }, c.req.param("id")));
  app.get("/portal/website/photos/:id", (c) => send({ kind: "client", session: deps.clientOf(c.req.header("cookie") ?? "") }, c.req.param("id")));
  return app;
}

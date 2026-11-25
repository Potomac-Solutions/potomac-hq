// Reviews' and case studies' forms, a screenshot for Potomac's people, and
// what the website reads with its token (decision 0013, section 6).
import { Hono } from "hono";
import { mayManageShowcase, addReview, addShot, askForReview, publicShot, publicShowcase, removeShot, saveCaseStudy, setReviewShown, shotFor, writeReviewByLink, writeReviewInPortal, type ShowcaseDeps, type WriteInput } from "../application/showcase.ts";
import { formPosts, parseId, readForm, withMessage, type FormFields, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "no-email": "Nobody at this client has an email to ask. Add one to their primary contact.",
  "email-off": "Email isn’t set up, so the link can’t be sent yet.",
  "send-failed": "The email couldn’t be sent. Try again in a minute.",
  "rating-invalid": "Choose from 1 to 5 stars.",
  "text-missing": "Write a few words about working with us.",
  "text-too-long": "Keep it under 1,000 characters.",
  "name-missing": "Say what name to show, like Rita M.",
  "name-too-long": "Keep the name under 80 characters.",
  "town-too-long": "Keep the town under 80 characters.",
  "invalid-source": "Choose where the review came from.",
  "invalid-link": "That link doesn’t work any more. Ask us for a new one.",
  "already-written": "You’ve already written a review. Thank you!",
  "not-allowed-to-show": "The writer didn’t say it may be shown, so it can’t be published.",
  "headline-missing": "Give the case study a headline.",
  "headline-too-long": "Keep the headline under 120 characters.",
  "text-too-long-study": "Keep each part under 2,000 characters.",
  "url-invalid": "The live address must be an https address, or empty.",
  "position-invalid": "The place on the Work page is a number from 1 to 999.",
  "shot-missing": "Choose a screenshot to upload.",
  "shot-too-large": "That picture is over 3 MB. Save it smaller and try again.",
  "shot-not-a-picture": "That isn’t a JPEG, PNG or WebP picture.",
  "alt-missing": "Describe the screenshot for people who can’t see it.",
  "alt-too-long": "Keep the description under 200 characters.",
  "too-many-shots": "A case study has up to 6 screenshots. Remove one first.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";
const writeInput = (f: FormFields): WriteInput => ({ rating: f["rating"] ?? "", text: f["text"] ?? "", displayName: f["displayName"] ?? "", town: f["town"] ?? null, mayPublish: f["mayPublish"] === "1" });

export type AskMail = (to: { readonly name: string; readonly email: string }, link: string, clientName: string) => Promise<boolean>;

export function showcaseStaffRoutes(deps: { readonly showcase: ShowcaseDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string; readonly publicUrl: string; readonly mail: AskMail | null }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor: (code) => messageFor(code), home: "/reviews" });
  const page = (id: Id | null) => `/clients/${id}/showcase`;
  post(
    "/clients/:id/review-request",
    async (actor, _f, id) => {
      if (!deps.mail) return { ok: false as const, error: mayManageShowcase(deps.showcase, actor) ? "email-off" : "forbidden" };
      const made = askForReview(deps.showcase, actor, id as Id);
      if (!made.ok) return made;
      const sent = await deps.mail(made.value.to, `${deps.publicUrl}/review?t=${made.value.token}`, deps.showcase.clientName(id as Id) ?? "").catch(() => false);
      return sent ? { ok: true as const, value: made.value.to.email } : { ok: false as const, error: "send-failed" };
    },
    { done: (_v, id) => page(id), back: (id) => page(id), message: (email) => `Asked. The link went to ${String(email)}; it works for 30 days.` },
  );
  post("/clients/:id/reviews", (actor, f, id) => addReview(deps.showcase, actor, id as Id, { rating: f["rating"] ?? "", text: f["text"] ?? "", displayName: f["displayName"] ?? "", town: f["town"] ?? null, source: f["source"] ?? "" }), {
    done: () => "/reviews",
    back: (id) => `${page(id)}#add-review`,
    message: "Added. Publish it on the Reviews page when you’re ready.",
  });
  post("/reviews/:id/publish", (actor, _f, id) => setReviewShown(deps.showcase, actor, id as Id, true), { done: () => "/reviews", back: () => "/reviews", message: "Published. The website shows it from its next check." });
  post("/reviews/:id/hide", (actor, _f, id) => setReviewShown(deps.showcase, actor, id as Id, false), { done: () => "/reviews", back: () => "/reviews", message: "Kept back. It isn’t shown anywhere." });
  post(
    "/clients/:id/case-study",
    (actor, f, id) => {
      const saved = saveCaseStudy(deps.showcase, actor, id as Id, { headline: f["headline"] ?? "", problem: f["problem"] ?? null, built: f["built"] ?? null, result: f["result"] ?? null, liveUrl: f["liveUrl"] ?? null, position: f["position"] ?? null, published: f["published"] === "1" });
      return !saved.ok && saved.error === "text-too-long" ? { ok: false as const, error: "text-too-long-study" } : saved;
    },
    { done: (_s, id) => page(id), back: (id) => page(id), message: (study) => (study.published ? "Saved and published." : "Saved as a draft.") },
  );
  post("/case-studies/:id/shots", (actor, f, id, files) => addShot(deps.showcase, actor, id as Id, { bytes: files["shot"]?.bytes ?? null, alt: f["alt"] ?? "" }), {
    done: (study) => `${page(study.organizationId)}#shots`,
    back: (_id, f) => (parseId(f["organizationId"] ?? "").ok ? `${page(f["organizationId"] as Id)}#shots` : "/reviews"),
    message: "Screenshot added.",
  });
  post("/case-study-shots/:id/remove", (actor, _f, id) => removeShot(deps.showcase, actor, id as Id), {
    done: (study) => `${page(study.organizationId)}#shots`,
    back: () => "/reviews",
    message: "Screenshot removed.",
  });
  return app;
}

/** Writing a review: from the emailed link, or signed in to the portal. */
export function reviewWritingRoutes(deps: { readonly showcase: ShowcaseDeps; readonly sign: (location: string) => string; readonly clientOf: (cookieHeader: string) => { readonly clientUserId: Id; readonly organizationId: Id } | null }): Hono {
  const app = new Hono();
  app.post("/review", async (c) => {
    const { fields } = await readForm(c);
    const token = fields["t"] ?? "";
    const made = writeReviewByLink(deps.showcase, token, writeInput(fields));
    const to = made.ok ? withMessage("/review/thanks", "done", "Thank you! It means a lot to a small business like ours.") : withMessage(made.error === "invalid-link" ? "/review" : `/review?t=${encodeURIComponent(token)}`, "problem", messageFor(made.error));
    return new Response(null, { status: 303, headers: { location: deps.sign(to) } });
  });
  const post = formPosts<{ readonly clientUserId: Id; readonly organizationId: Id } | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor, home: "/portal" });
  post("/portal/review", (session, f) => writeReviewInPortal(deps.showcase, session, writeInput(f)), { done: () => "/portal", back: () => "/portal/review", message: "Thank you for your review! It means a lot to a small business like ours." });
  return app;
}

const picture = (shot: { readonly bytes: Uint8Array; readonly contentType: string } | null, cache: string) =>
  shot ? new Response(new Uint8Array(shot.bytes), { status: 200, headers: { "content-type": shot.contentType, "cache-control": cache, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } }) : new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** A screenshot, for Potomac's people. */
export function showcaseDownloads(deps: { readonly showcase: ShowcaseDeps; readonly actorOf: (cookieHeader: string) => Id | null }): Hono {
  const app = new Hono();
  app.get("/case-study-shots/:id", (c) => {
    const id = parseId(c.req.param("id"));
    return picture(id.ok ? shotFor(deps.showcase, deps.actorOf(c.req.header("cookie") ?? ""), id.value) : null, "private, no-store");
  });
  return app;
}

/** GET /api/site/showcase and its screenshots: what the website shows, with its token. Only what is published. */
export function showcaseApiRoutes(deps: { readonly showcase: ShowcaseDeps; readonly isSite: (token: string | null) => boolean; readonly allow: (incoming: Request) => boolean }): Hono {
  const app = new Hono();
  const tokenOf = (header: string | undefined) => /^Bearer (\S+)$/.exec(header ?? "")?.[1] ?? null;
  const refused = (status: 401 | 429) => new Response(JSON.stringify({ ok: false }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  app.get("/api/site/showcase", (c) => {
    if (!deps.allow(c.req.raw)) return refused(429);
    if (!deps.isSite(tokenOf(c.req.header("authorization")))) return refused(401);
    return c.json({ ok: true, ...publicShowcase(deps.showcase) }, 200, { "cache-control": "no-store" });
  });
  app.get("/api/site/showcase/files/:id", (c) => {
    if (!deps.allow(c.req.raw)) return refused(429);
    if (!deps.isSite(tokenOf(c.req.header("authorization")))) return refused(401);
    const id = parseId(c.req.param("id"));
    return picture(id.ok ? publicShot(deps.showcase, id.value) : null, "private, max-age=300");
  });
  return app;
}

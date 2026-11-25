// The newsletter's forms and addresses (decision 0013, section 1).
//   Staff: issues and the list, under /newsletter.
//   Anyone: signing up at /river, confirming, and leaving.
//   The website's server: POST /api/site/newsletter with its token.
//   Mail apps: POST /river/one-click, the one-click unsubscribe (RFC 8058).
import { Hono } from "hono";
import { STOPS, addIssue, changeSubscriberStop, confirmSubscription, editIssue, forgetSubscriber, removeIssue, sendIssue, signUp, testIssue, unsubscribe, type FooterOptions, type IssueInput, type NewsletterDeps, type SignUpInput } from "../application/newsletter.ts";
import { formPosts, readForm, withMessage, type FormFields, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "email-invalid": "Enter your email, like you@example.com.",
  "name-too-long": "Keep your name under 80 characters.",
  "subject-missing": "Give the issue a subject.",
  "subject-too-long": "Keep the subject under 120 characters.",
  "body-missing": "Write the issue first.",
  "body-too-long": "Keep an issue under 20,000 characters.",
  "invalid-stop": "Choose stops from the list.",
  "already-sent": "That issue has already gone out, so it can’t be changed.",
  "no-address": "Every issue must carry Potomac’s mailing address. Set HQ_CONTACT_ADDRESS on the server first.",
  "no-one": "Nobody on the list is in those stops yet.",
  "email-off": "Email isn’t set up, so nothing can be sent. Set the Brevo key first.",
  "invalid-link": "That link doesn’t work any more. Sign up again and we’ll send a new one.",
  "too-many": "That’s a lot of sign-ups at once. Try again later.",
  "test-failed": "The test email couldn’t be sent. Check that email is set up.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

/** Sends one email; true when it went. */
type Mail = (message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>;

const issueInput = (f: FormFields): IssueInput => ({ subject: f["subject"] ?? "", body: f["body"] ?? "", stops: STOPS.filter((stop) => f[`stop-${stop}`] === "1") });

export function newsletterRoutes(deps: { readonly newsletter: NewsletterDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string; readonly footer: FooterOptions; readonly mail: Mail | null }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/newsletter" });
  post("/newsletter/issues", (actor, f) => addIssue(deps.newsletter, actor, issueInput(f)), {
    done: (issue) => `/newsletter/issues/${issue.id}`,
    back: () => "/newsletter#write",
    message: "Saved as a draft. Send yourself a test, then send it.",
  });
  post("/newsletter/issues/:id", (actor, f, id) => editIssue(deps.newsletter, actor, id as Id, issueInput(f)), {
    done: (issue) => `/newsletter/issues/${issue.id}`,
    back: (id) => `/newsletter/issues/${id}`,
    message: "Saved.",
  });
  post("/newsletter/issues/:id/remove", (actor, _f, id) => removeIssue(deps.newsletter, actor, id as Id), {
    done: () => "/newsletter",
    back: (id) => `/newsletter/issues/${id}`,
    message: "Draft deleted.",
  });
  post(
    "/newsletter/issues/:id/test",
    async (actor, _f, id) => {
      const made = testIssue(deps.newsletter, actor, id as Id, deps.footer);
      if (!made.ok) return made;
      if (!deps.mail) return { ok: false as const, error: "email-off" };
      return (await deps.mail(made.value)) ? { ok: true as const, value: made.value.to } : { ok: false as const, error: "test-failed" };
    },
    { done: (_to, id) => `/newsletter/issues/${id}`, back: (id) => `/newsletter/issues/${id}`, message: (to) => `Test sent to ${String(to)}.` },
  );
  post("/newsletter/issues/:id/send", (actor, _f, id) => sendIssue(deps.newsletter, actor, id as Id, { address: deps.footer.address, emailOn: deps.mail !== null }), {
    done: (_sent, id) => `/newsletter/issues/${id}`,
    back: (id) => `/newsletter/issues/${id}`,
    message: (sent) => `Sending to ${sent.reach} ${sent.reach === 1 ? "reader" : "readers"}. It goes out in batches over the next few minutes.`,
  });
  post("/newsletter/subscribers/:id", (actor, f, id) => changeSubscriberStop(deps.newsletter, actor, id as Id, f["stop"] ?? ""), {
    done: () => "/newsletter#readers",
    back: () => "/newsletter#readers",
    message: "Moved.",
  });
  post("/newsletter/subscribers/:id/forget", (actor, _f, id) => forgetSubscriber(deps.newsletter, actor, id as Id), {
    done: () => "/newsletter#readers",
    back: () => "/newsletter#readers",
    message: "Taken off the list and forgotten.",
  });
  return app;
}

export type ConfirmMail = (to: { readonly email: string; readonly name: string | null }, link: string) => Promise<boolean>;

/** A return address on one of the website's own origins, or null. */
function returnTo(raw: string, origins: readonly string[]): string | null {
  try {
    const url = new URL(raw);
    return origins.includes(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
}

const CHECK_EMAIL = "Check your email: we sent a link to confirm. It works for a week.";

/** Signs someone up and emails the link. The answer never says whether they were on the list already. */
async function signUpAndMail(deps: { readonly newsletter: NewsletterDeps; readonly mailConfirm: ConfirmMail | null; readonly publicUrl: string; readonly log: (message: string, error?: unknown) => void }, input: SignUpInput) {
  const made = signUp(deps.newsletter, input);
  if (!made.ok) return made;
  const confirm = made.value.confirm;
  if (confirm && deps.mailConfirm) {
    const sent = await deps.mailConfirm(confirm, `${deps.publicUrl}/river/confirm?t=${confirm.token}`).catch(() => false);
    if (!sent) deps.log("Newsletter: a confirm link could not be emailed");
  }
  return made;
}

export type PublicNewsletterDeps = {
  readonly newsletter: NewsletterDeps;
  readonly sign: (location: string) => string;
  /** Null when email is off: sign-ups are then refused, since nobody could confirm. */
  readonly mailConfirm: ConfirmMail | null;
  readonly publicUrl: string;
  readonly returnOrigins: readonly string[];
  readonly addressOf: (incoming: unknown) => string;
  readonly allowPerAddress: (key: string) => boolean;
  readonly allowPerEmail: (key: string) => boolean;
  readonly log: (message: string, error?: unknown) => void;
};

/** The sign-up form at /river, and the Confirm and Unsubscribe buttons. */
export function riverRoutes(deps: PublicNewsletterDeps): Hono<{ Bindings: { incoming: unknown } }> {
  const app = new Hono<{ Bindings: { incoming: unknown } }>();
  const go = (location: string) => new Response(null, { status: 303, headers: { location: deps.sign(location) } });

  app.post("/river", async (c) => {
    const { fields } = await readForm(c);
    const back = returnTo(fields["return_to"] ?? "", deps.returnOrigins);
    const answer = (name: "done" | "problem", message: string) => (back ? new Response(null, { status: 303, headers: { location: withMessage(back, name, message) } }) : go(withMessage(name === "done" ? "/river/check" : "/river", name, message)));
    // A field only bots fill in. They're told it worked.
    if ((fields["website"] ?? "") !== "") return answer("done", CHECK_EMAIL);
    if (!deps.mailConfirm) return answer("problem", "Signing up isn’t working right now. Try again later.");
    const email = (fields["email"] ?? "").trim().toLowerCase();
    if (!deps.allowPerAddress(deps.addressOf(c.env.incoming)) || (email && !deps.allowPerEmail(email))) return answer("problem", messageFor("too-many"));
    const made = await signUpAndMail(deps, { email, name: fields["name"] ?? null, src: fields["src"] ?? null, source: back ? "site" : "page" });
    return made.ok ? answer("done", CHECK_EMAIL) : answer("problem", messageFor(made.error));
  });

  app.post("/river/confirm", async (c) => {
    const { fields } = await readForm(c);
    const done = confirmSubscription(deps.newsletter, fields["t"] ?? "");
    return done.ok ? go(withMessage("/river/thanks", "done", "You’re on the list.")) : go(withMessage("/river", "problem", messageFor(done.error)));
  });

  app.post("/river/unsubscribe", async (c) => {
    const { fields } = await readForm(c);
    const done = unsubscribe(deps.newsletter, fields["t"] ?? "");
    return done.ok ? go(withMessage("/river/left", "done", "You’re off the list. We won’t email you again.")) : go(withMessage("/river", "problem", messageFor(done.error)));
  });
  return app;
}

const noStore = { "cache-control": "no-store" };

/**
 * The two addresses called from outside a browser form: the website's server
 * signing someone up, and a mail app's one-click unsubscribe.
 */
export function newsletterApiRoutes(deps: {
  readonly newsletter: NewsletterDeps;
  readonly mailConfirm: ConfirmMail | null;
  readonly publicUrl: string;
  readonly isSite: (token: string | null) => boolean;
  readonly allowApi: (incoming: Request) => boolean;
  readonly allowPerVisitor: (key: string) => boolean;
  readonly allowPerEmail: (key: string) => boolean;
  readonly log: (message: string, error?: unknown) => void;
}): Hono {
  const app = new Hono();
  const tokenOf = (header: string | undefined) => /^Bearer (\S+)$/.exec(header ?? "")?.[1] ?? null;

  app.post("/api/site/newsletter", async (c) => {
    if (!deps.allowApi(c.req.raw)) return c.json({ ok: false }, 429, noStore);
    if (!deps.isSite(tokenOf(c.req.header("authorization")))) return c.json({ ok: false }, 401, noStore);
    const length = Number(c.req.header("content-length") ?? "");
    if (!Number.isInteger(length) || length <= 0 || length > 4000) return c.json({ ok: false, error: "bad-request" }, 400, noStore);
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
      if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    } catch {
      return c.json({ ok: false, error: "bad-request" }, 400, noStore);
    }
    const field = (key: string, most: number) => (typeof body[key] === "string" ? (body[key] as string).slice(0, most) : "");
    if (!deps.mailConfirm) return c.json({ ok: false, error: "closed", message: "Signing up isn’t working right now. Try again later." }, 503, noStore);
    const email = field("email", 300).trim().toLowerCase();
    if (!deps.allowPerVisitor(field("visitor", 100) || "unknown") || (email && !deps.allowPerEmail(email))) return c.json({ ok: false, error: "too-many", message: messageFor("too-many") }, 429, noStore);
    const made = await signUpAndMail(deps, { email, name: field("name", 200) || null, src: field("src", 100), source: "site" });
    if (!made.ok) return c.json({ ok: false, error: made.error, message: messageFor(made.error) }, 400, noStore);
    return c.json({ ok: true, status: "check-email", message: CHECK_EMAIL }, 200, noStore);
  });

  // RFC 8058: the mail app posts "List-Unsubscribe=One-Click" with no cookie
  // and no Origin. The token is the only thing that says who.
  app.post("/river/one-click", (c) => {
    const done = unsubscribe(deps.newsletter, c.req.query("t") ?? "");
    return c.text(done.ok ? "Unsubscribed." : "That link doesn’t work.", done.ok ? 200 : 404, noStore);
  });
  return app;
}

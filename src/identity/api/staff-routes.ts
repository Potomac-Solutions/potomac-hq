// The sign-in routes under /staff. The kit's staff pages answer them. This
// file adds what HQ needs around that: a rate limit, a body size limit, the
// link to HQ's own users, and an activity event for every session change.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RateLimit } from "../application/ports.ts";
import { establishUser, recordSessionEvent, type SessionDeps, type SignedInAccount } from "../application/session.ts";

export type StaffRoutesDeps = {
  /** The kit's staff pages. Resolves true when it answered the request. */
  readonly handle: (req: IncomingMessage, res: ServerResponse, url: URL, form: URLSearchParams | null) => Promise<boolean>;
  /** Who a request, or a Cookie header, is signed in as. */
  readonly session: (input: IncomingMessage | string) => SignedInAccount | null;
  readonly clientOf: (req: IncomingMessage) => string;
  readonly allowAttempt: RateLimit;
  readonly sessionDeps: SessionDeps;
  readonly problem: (res: ServerResponse, status: number, title: string, message: string) => void;
  readonly log: (message: string, error: unknown) => void;
};

const MAX_BODY_BYTES = 16 * 1024;
// Guessable or expensive: each attempt costs a password hash.
const LIMITED = new Set(["/staff/sign-in", "/staff/accept"]);

export function staffRoutes(deps: StaffRoutesDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> {
  return async function handleStaff(req, res, url) {
    const path = url.pathname;
    const post = req.method === "POST";

    // Managing people is not part of v0.1 (docs/scope-v0.1-v0.2.md). The kit's
    // own People pages would create accounts HQ knows nothing about.
    if (path === "/staff/people" || path.startsWith("/staff/people/")) {
      return deps.problem(res, 404, "Not found", "There is no page at this address.");
    }

    if (post && LIMITED.has(path) && !deps.allowAttempt(`${path} ${deps.clientOf(req)}`)) {
      res.setHeader("retry-after", "60");
      return deps.problem(res, 429, "Too many tries", "Wait a minute, then try again.");
    }

    let form: URLSearchParams | null = null;
    if (post) {
      const body = await readForm(req);
      if (body === "too-large") return deps.problem(res, 413, "Too much data", "That form was too large.");
      if (body === "not-a-form") return deps.problem(res, 415, "Not a form", "This address only accepts form posts.");
      form = body;
    }

    const before = post ? deps.session(req) : null;
    const answered = await deps.handle(req, res, url, form);
    if (!answered) return deps.problem(res, 404, "Not found", "There is no page at this address.");
    if (!post) return;

    // The kit has answered. Record what changed. A failure here must not
    // turn into a second response, so it is logged.
    try {
      if (path === "/staff/sign-in" || path === "/staff/accept") {
        const cookie = sessionCookie(res);
        const who = cookie ? deps.session(cookie) : null;
        const user = who ? establishUser(deps.sessionDeps, who) : null;
        if (user) recordSessionEvent(deps.sessionDeps, user, "user.signed-in");
      } else if (before && path === "/staff/sign-out") {
        const user = deps.sessionDeps.users.findByStaffAccount(before.account);
        if (user) recordSessionEvent(deps.sessionDeps, user, "user.signed-out");
      } else if (before && path === "/staff/password" && String(res.getHeader("location") ?? "").includes("done=")) {
        const user = deps.sessionDeps.users.findByStaffAccount(before.account);
        if (user) recordSessionEvent(deps.sessionDeps, user, "user.password-changed");
      }
    } catch (error) {
      deps.log(`Could not record the activity event for POST ${path}`, error);
    }
  };
}

/** The Cookie header a browser would send back for a Set-Cookie the kit just set. */
function sessionCookie(res: ServerResponse): string | null {
  const header = res.getHeader("set-cookie");
  const first = Array.isArray(header) ? header[0] : header;
  if (typeof first !== "string") return null;
  const pair = first.split(";")[0] ?? "";
  return pair.endsWith("=") ? null : pair;
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams | "too-large" | "not-a-form"> {
  const type = String(req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") {
    req.resume();
    return "not-a-form";
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      return "too-large";
    }
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

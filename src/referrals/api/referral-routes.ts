// Referral links' forms, the short address a QR code opens, and the QR
// picture itself.
import { Hono } from "hono";
import { addReferralLink, editReferralLink, followReferralLink, referralQr, removeReferralLink, type ReferralsDeps } from "../application/referrals.ts";
import { formPosts, parseId, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "label-missing": "Say what the link is printed on, like Business cards.",
  "label-too-long": "Keep that under 120 characters.",
  "code-invalid": "A code is 2 to 32 lower-case letters, digits and hyphens, like card or flyer-2027. Leave it empty and HQ makes one up.",
  "code-taken": "Another link already uses that code. Choose a different one.",
  "destination-invalid": "Enter where a scan should go: an https address like potomac.solutions, or a page here like /contact.",
  "too-many": "HQ keeps up to 500 referral links.",
  "in-use": "That link has been scanned, so it stays. Printed codes may still be out there.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export function referralRoutes(deps: { readonly referrals: ReferralsDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/referrals" });
  post("/referrals", (actor, f) => addReferralLink(deps.referrals, actor, { code: f["code"] ?? "", label: f["label"] ?? "", destination: f["destination"] ?? "" }), {
    done: (link) => `/referrals#link-${link.code}`,
    back: () => "/referrals#add",
    message: "Link made. Print its QR code, or copy its address.",
  });
  post("/referrals/:id", (actor, f, id) => editReferralLink(deps.referrals, actor, id as Id, { label: f["label"] ?? "", destination: f["destination"] ?? "" }), {
    done: (link) => `/referrals#link-${link.code}`,
    back: () => "/referrals",
    message: "Saved. Scans go to the new address from now on.",
  });
  post("/referrals/:id/remove", (actor, _f, id) => removeReferralLink(deps.referrals, actor, id as Id), {
    done: () => "/referrals",
    back: () => "/referrals",
    message: "Removed.",
  });
  return app;
}

/**
 * GET /r/<code>, which a QR code opens, and each link's QR picture.
 * `publicUrl` is HQ's own address with no slash at the end.
 */
export function referralDownloads(deps: { readonly referrals: ReferralsDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly publicUrl: string }): Hono {
  const app = new Hono();
  const missing = () => new Response("This link isn’t in use.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

  app.get("/r/:code", (c) => {
    // A HEAD request is a program checking the address, never a scan.
    const to = followReferralLink(deps.referrals, c.req.param("code"), c.req.method === "HEAD" ? "" : (c.req.header("user-agent") ?? ""));
    if (!to) return missing();
    // Never stored, so every scan reaches HQ and is counted.
    return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
  });

  app.get("/referrals/:id/qr.svg", (c) => {
    const id = parseId(c.req.param("id"));
    const made = id.ok ? referralQr(deps.referrals, deps.actorOf(c.req.header("cookie") ?? ""), id.value, deps.publicUrl) : null;
    if (!made || !made.ok) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    const download = c.req.query("download") === "1";
    return new Response(made.value.svg, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
        ...(download ? { "content-disposition": `attachment; filename="${made.value.fileName}"` } : {}),
      },
    });
  });
  return app;
}

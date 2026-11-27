// Client QR codes (decision 0023): the forms, in the portal and in HQ; the
// pictures to download; and the address the script on a client's site
// reports scans to.
import { Hono } from "hono";
import { addCode, codePicture, removeCode, renameCode, reportEvent, setRetired, type ClientPerson, type SiteQrDeps, type Staff, type Who } from "../application/site-qr.ts";
import { formPosts, parseId, readForm, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "label-missing": "Say what the code is printed on, like Business cards.",
  "label-too-long": "Keep that under 120 characters.",
  "code-invalid": "A code is 2 to 32 lower-case letters, digits and hyphens, like card or flyer-2027. Leave it empty and we make one up.",
  "code-taken": "Another of your QR codes already uses that code. Choose a different one.",
  "page-invalid": "Enter a page on your website, like / for the home page or /services.",
  "site-invalid": "Choose which of your websites the code opens.",
  "no-site": "We don’t have your website’s address yet. Ask us to add it, then make a code.",
  "too-many": "You can keep up to 100 QR codes. Remove one nobody has scanned to make room.",
  "in-use": "That code has been scanned, so it can’t be removed. Retire it instead: printed cards may still be out there.",
  unchanged: "Nothing changed.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

const newInput = (f: Readonly<Record<string, string>>) => ({ code: f["code"] ?? "", label: f["label"] ?? "", site: f["site"] ?? "", page: f["page"] ?? "" });
const made = "QR code made. Download it for your cards or flyers.";

/** What a client posts about their own codes. */
export function siteQrPortalRoutes(deps: { readonly siteQr: SiteQrDeps; readonly clientOf: (cookieHeader: string) => ClientPerson | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts<ClientPerson | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor, home: "/portal/qr-codes" });
  const who = (session: ClientPerson | null): Who => ({ kind: "client", session });
  const list = () => "/portal/qr-codes";
  post("/portal/qr-codes", (session, f) => addCode(deps.siteQr, who(session), newInput(f)), { done: (code) => `/portal/qr-codes#code-${code.code}`, back: () => "/portal/qr-codes#add", message: made });
  post("/portal/qr-codes/:id/rename", (session, f, id) => renameCode(deps.siteQr, who(session), id as Id, f["label"] ?? ""), { done: (code) => `/portal/qr-codes#code-${code.code}`, back: list, message: "Saved." });
  post("/portal/qr-codes/:id/retire", (session, _f, id) => setRetired(deps.siteQr, who(session), id as Id, true), { done: list, back: list, message: "Retired. It still counts if someone scans an old card." });
  post("/portal/qr-codes/:id/restore", (session, _f, id) => setRetired(deps.siteQr, who(session), id as Id, false), { done: (code) => `/portal/qr-codes#code-${code.code}`, back: list, message: "Brought back." });
  post("/portal/qr-codes/:id/remove", (session, _f, id) => removeCode(deps.siteQr, who(session), id as Id), { done: list, back: list, message: "Removed." });
  return app;
}

/** What Potomac's people post about a client's codes. */
export function siteQrStaffRoutes(deps: { readonly siteQr: SiteQrDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/clients" });
  const staff = (actorId: Id | null): Staff => ({ kind: "staff", actorId });
  const list = (code: { readonly organizationId: Id }) => `/clients/${code.organizationId}/qr-codes`;
  post("/clients/:id/qr-codes", (actor, f, id) => addCode(deps.siteQr, { kind: "staff", actorId: actor, organizationId: id as Id }, newInput(f)), {
    done: (code) => `${list(code)}#code-${code.code}`,
    back: (id) => `/clients/${id}/qr-codes#add`,
    message: "QR code made. Download it, or send the client to their portal for it.",
  });
  post("/site-qr/:id/rename", (actor, f, id) => renameCode(deps.siteQr, staff(actor), id as Id, f["label"] ?? ""), { done: (code) => `${list(code)}#code-${code.code}`, back: () => "/clients", message: "Saved." });
  post("/site-qr/:id/retire", (actor, _f, id) => setRetired(deps.siteQr, staff(actor), id as Id, true), { done: list, back: () => "/clients", message: "Retired. It still counts if someone scans an old card." });
  post("/site-qr/:id/restore", (actor, _f, id) => setRetired(deps.siteQr, staff(actor), id as Id, false), { done: (code) => `${list(code)}#code-${code.code}`, back: () => "/clients", message: "Brought back." });
  post("/site-qr/:id/remove", (actor, _f, id) => removeCode(deps.siteQr, staff(actor), id as Id), { done: list, back: () => "/clients", message: "Removed." });
  return app;
}

/** Each code's QR picture, as SVG or PNG, for its client in the portal and for Potomac's people. */
export function siteQrDownloads(deps: { readonly siteQr: SiteQrDeps; readonly clientOf: (cookieHeader: string) => ClientPerson | null; readonly actorOf: (cookieHeader: string) => Id | null }): Hono {
  const app = new Hono();
  const missing = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const send = (who: Who | Staff, typedId: string, format: "svg" | "png", download: boolean) => {
    const id = parseId(typedId);
    const picture = id.ok ? codePicture(deps.siteQr, who, id.value, format) : null;
    if (!picture || !picture.ok) return missing();
    return new Response(picture.value.body as ConstructorParameters<typeof Response>[0], {
      status: 200,
      headers: {
        "content-type": picture.value.contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
        ...(download ? { "content-disposition": `attachment; filename="${picture.value.fileName}"` } : {}),
      },
    });
  };
  for (const format of ["svg", "png"] as const) {
    app.get(`/portal/qr-codes/:id/qr.${format}`, (c) => send({ kind: "client", session: deps.clientOf(c.req.header("cookie") ?? "") }, c.req.param("id"), format, c.req.query("download") === "1"));
    app.get(`/site-qr/:id/qr.${format}`, (c) => send({ kind: "staff", actorId: deps.actorOf(c.req.header("cookie") ?? "") }, c.req.param("id"), format, c.req.query("download") === "1"));
  }
  return app;
}

/**
 * POST /hooks/site-qr: the script on a client's site reporting a scan, or a
 * tap after one. Anyone may send it, from anywhere, so it always answers the
 * same few words and says nothing about whether it counted. A browser reads
 * the answer only to know whether to keep the report for later, so it is
 * open to every origin and carries no cookie.
 */
export function siteQrHookRoutes(deps: { readonly siteQr: SiteQrDeps; readonly addressOf: (incoming: unknown) => string; readonly allow: (address: string) => boolean; readonly firstInWindow: (key: string) => boolean }): Hono {
  const app = new Hono();
  const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST", "access-control-max-age": "86400", "cache-control": "no-store" };
  const answer = (status: 204 | 400 | 413 | 429) => new Response(null, { status, headers: CORS });
  app.options("/hooks/site-qr", () => answer(204));
  app.post("/hooks/site-qr", async (c) => {
    // The visitor's network address, from Node's own request: only for the limits, never kept.
    const address = deps.addressOf((c.env as { incoming?: unknown } | undefined)?.incoming);
    if (!deps.allow(address)) return answer(429);
    const length = Number(c.req.header("content-length") ?? "0");
    if (!(length >= 0 && length <= 500)) return answer(413);
    const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (type !== "application/x-www-form-urlencoded" && type !== "text/plain") return answer(400);
    let fields: Record<string, string>;
    try {
      fields = type === "text/plain" ? Object.fromEntries(new URLSearchParams(await c.req.text())) : (await readForm(c)).fields;
    } catch {
      return answer(400);
    }
    const origin = c.req.header("origin") ?? "";
    const code = (fields["code"] ?? "").trim().toLowerCase();
    const kind = (fields["kind"] ?? "").trim().toLowerCase();
    // The same visit's scan, or tap, of the same code counts once in 30 minutes. A visit is a
    // random word the script keeps for the browser tab, never stored here: phones on one mobile
    // network often share an address, so the address alone would count many people as one.
    const visit = /^[a-z0-9]{4,16}$/.test(fields["v"] ?? "") ? `visit:${fields["v"]}` : `address:${address}`;
    if (origin && code && kind && deps.firstInWindow(`${visit}|${origin}|${code}|${kind}`)) {
      reportEvent(deps.siteQr, { origin, userAgent: c.req.header("user-agent") ?? "" }, { code, kind, t: fields["t"] ?? "" });
    }
    return answer(204);
  });
  return app;
}

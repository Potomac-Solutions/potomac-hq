// Renewals' forms: add one to a client, mark one renewed, retire one.
import { Hono } from "hono";
import { addRenewal, answerRenewal, billRenewal, markRenewed, retireRenewal, type RenewalClient, type RenewalsDeps } from "../application/renewals.ts";
import { formPosts, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "invalid-kind": "Choose what it is from the list.",
  "name-missing": "Name it: like feedstore.com, or Shared hosting.",
  "name-too-long": "Keep the name under 120 characters.",
  "provider-too-long": "Keep the provider under 80 characters.",
  "invalid-date": "Enter the day it renews.",
  "invalid-term": "Choose how often from the list.",
  "not-an-amount": "Enter amounts like 12.50.",
  "note-too-long": "Keep the note under 500 characters.",
  "not-billed-to-client": "Set what we bill for it first. A renewal with no price is ours to pay.",
  "already-billed": "This renewal is already billed for its coming term.",
  "invalid-choice": "Choose renew it, or let it lapse.",
  "already-paid": "That’s paid already, thank you. We’ll renew it.",
  "too-late": "It has already come up for renewal. Call or message us about it.",
  "project-missing": "That project isn’t this client’s. Choose one of theirs, or bill the client with no project.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export function renewalRoutes(deps: { readonly renewals: RenewalsDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/renewals" });
  const back = (form: Readonly<Record<string, string>>, fallback: string) => (form["back"] === "client" && /^[0-9a-f-]{36}$/.test(form["clientId"] ?? "") ? `/clients/${form["clientId"]}#renewals` : fallback);
  post(
    "/clients/:id/renewals",
    (actor, f, id) => addRenewal(deps.renewals, actor, id as Id, { kind: f["kind"] ?? "", name: f["name"] ?? "", provider: f["provider"] ?? null, renewsOn: f["renewsOn"] ?? "", termMonths: f["termMonths"] ?? "", cost: f["cost"] ?? null, price: f["price"] ?? null, autoRenews: f["autoRenews"] === "1", note: f["note"] ?? null }),
    { done: (_, id) => `/clients/${id}#renewals`, back: (id) => `/clients/${id}#renewals`, message: "Added. It shows on the dashboard when it is 30 days away." },
  );
  post("/renewals/:id/renewed", (actor, _f, id) => markRenewed(deps.renewals, actor, id as Id), { done: (_v, _id, f) => back(f, "/renewals"), back: (_id, f) => back(f, "/renewals"), message: "Marked renewed. Its next date moved on." });
  post("/renewals/:id/bill", (actor, f, id) => billRenewal(deps.renewals, actor, id as Id, { projectId: f["projectId"] ?? "" }), { done: (_v, _id, f) => back(f, "/renewals"), back: (_id, f) => back(f, "/renewals"), message: "Billed. The invoice is in the client’s portal, due a week before it renews." });
  post("/renewals/:id/retire", (actor, _f, id) => retireRenewal(deps.renewals, actor, id as Id), { done: (_v, _id, f) => back(f, "/renewals"), back: (_id, f) => back(f, "/renewals"), message: "Removed from renewals." });
  return app;
}

/** The client's side: renew it, or let it lapse, from their portal. */
export function renewalPortalRoutes(deps: { readonly renewals: RenewalsDeps; readonly clientOf: (cookieHeader: string) => RenewalClient | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts<RenewalClient | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor, home: "/portal" });
  post("/portal/renewals/:id/answer", (session, f, id) => answerRenewal(deps.renewals, session, id as Id, f["choice"] ?? ""), {
    done: () => "/portal#renewals",
    back: () => "/portal#renewals",
    message: (choice) => (choice === "renew" ? "Thank you. We’ll renew it once it’s paid." : "Got it. We won’t renew it, and we’ll let it lapse."),
  });
  return app;
}

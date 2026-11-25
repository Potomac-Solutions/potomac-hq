// Referral credit's forms (decision 0013, section 7).
import { Hono } from "hono";
import { applyReferralCredit, makeClientLink, setCreditAmount, setReferredBy, type ReferralCreditDeps } from "../application/referral-credit.ts";
import { formPosts, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "name-too-long": "Keep the name under 100 characters.",
  "self-referral": "A client can’t refer themselves.",
  "already-has-one": "This client already has their own link.",
  "link-failed": "The link couldn’t be made. Make one by hand under Referral links.",
  "no-credit": "There’s no credit to take off this invoice.",
  "not-a-draft": "Credit only comes off a draft invoice.",
  "amount-invalid": "A referral is worth between $1 and $1,000, like 25.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export function referralCreditRoutes(deps: { readonly credit: ReferralCreditDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/clients" });
  post("/opportunities/:id/referred-by", (actor, f, id) => setReferredBy(deps.credit, actor, id as Id, { organizationId: f["organizationId"] ?? "", name: f["name"] ?? "" }), {
    done: (_v, id) => `/opportunities/${id}`,
    back: (id) => `/opportunities/${id}`,
    message: "Saved.",
  });
  post("/clients/:id/referral-link", (actor, _f, id) => makeClientLink(deps.credit, actor, id as Id), {
    done: (_v, id) => `/clients/${id}#referrals`,
    back: (id) => `/clients/${id}#referrals`,
    message: (made) => `Made. Their link ends in /r/${made.code}; they’ll see it in their portal.`,
  });
  post("/invoices/:id/referral-credit", (actor, _f, id) => applyReferralCredit(deps.credit, actor, id as Id), {
    done: (_v, id) => `/invoices/${id}`,
    back: (id) => `/invoices/${id}`,
    message: (made) => `Took ${made.applied} of referral credit off.`,
  });
  post("/referral-credit", (actor, f) => setCreditAmount(deps.credit, actor, f["amount"] ?? ""), {
    done: () => "/referrals#credit",
    back: () => "/referrals#credit",
    message: (set) => `Each referral now earns ${set.amount} of credit.`,
  });
  return app;
}

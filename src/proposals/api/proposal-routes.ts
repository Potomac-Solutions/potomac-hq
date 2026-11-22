// The proposals module's form posts and its one download, the PDF.
import { Hono } from "hono";
import * as proposals from "../application/commands.ts";
import { proposalVersion, type ProposalDocument } from "../application/queries.ts";
import { formPosts, parseId, type FormFields, type Id } from "../../shared/index.ts";
import { messageFor } from "./messages.ts";

export type ProposalRoutesDeps = {
  readonly proposals: proposals.ProposalsDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
};

/** The estimate form names its rows item-0, kind-0, quantity-0, rate-0, and so on. */
const MAX_ROWS = 60;
function rows(form: FormFields) {
  const found = [];
  for (let i = 0; i < MAX_ROWS; i += 1) {
    if (form[`item-${i}`] === undefined && form[`quantity-${i}`] === undefined && form[`rate-${i}`] === undefined) continue;
    found.push({ item: form[`item-${i}`] ?? "", kind: form[`kind-${i}`] ?? "hours", quantity: form[`quantity-${i}`] ?? "", rate: form[`rate-${i}`] ?? "" });
  }
  return found;
}

export function proposalRoutes(deps: ProposalRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/proposals" });
  const page = (id: Id | null) => (id ? `/proposals/${id}` : "/proposals");

  post("/opportunities/:id/proposals", (actor, f, id) => proposals.startProposal(deps.proposals, actor, id as Id, { template: f["template"] ?? null }), {
    done: (proposal) => page(proposal.id),
    back: (id) => `/opportunities/${id}`,
    message: "Proposal drafted. Check every word and number before sending.",
  });
  post(
    "/proposals/:id",
    (actor, f, id) =>
      proposals.saveProposal(deps.proposals, actor, id as Id, {
        title: f["title"] ?? "",
        pricing: f["pricing"] ?? "",
        scope: f["scope"] ?? null,
        assumptions: f["assumptions"] ?? null,
        exclusions: f["exclusions"] ?? null,
        deliverables: f["deliverables"] ?? null,
        lines: rows(f),
      }),
    { done: (_, id) => page(id), back: (id) => page(id), message: "Proposal saved." },
  );
  post("/proposals/:id/send", (actor, _f, id) => proposals.sendProposalVersion(deps.proposals, actor, id as Id), {
    done: (version, id) => `${page(id)}/versions/${version.number}`,
    back: (id) => page(id),
    message: "Sent as a new version. Download the PDF to send it to the client.",
  });
  post(
    "/proposals/:id/decision",
    (actor, f, id) => proposals.recordProposalDecision(deps.proposals, actor, id as Id, { decision: f["decision"] ?? "", byName: f["byName"] ?? "", on: f["on"] ?? "", method: f["method"] ?? "", note: f["note"] ?? null }),
    { done: (answer, id) => (answer.project ? `/projects/${answer.project.id}` : page(id)), back: (id) => page(id), message: "Answer recorded." },
  );
  post(
    "/proposals/:id/agreement",
    (actor, f, id, files) => proposals.recordAgreement(deps.proposals, actor, id as Id, { reference: f["reference"] ?? null, signedOn: f["signedOn"] ?? "", file: files["file"] ?? null }),
    { done: (_, id) => `${page(id)}#agreement`, back: (id) => `${page(id)}#agreement`, message: "Agreement recorded." },
  );
  post("/proposals/:id/share", (actor, f, id) => proposals.setProposalShared(deps.proposals, actor, id as Id, f["shared"] !== "0"), {
    done: (_, id) => page(id),
    back: (id) => page(id),
    message: "Sharing changed.",
  });
  return app;
}

export type ProposalDownloadDeps = {
  readonly proposals: proposals.ProposalsDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly renderPdf: (document: ProposalDocument) => Uint8Array<ArrayBuffer>;
};

/** GET /proposals/:id/versions/:n/pdf. Refused and missing both answer 404. */
export function proposalDownloads(deps: ProposalDownloadDeps): Hono {
  const app = new Hono();
  app.get("/proposals/:id/versions/:n/pdf", (c) => {
    const id = parseId(c.req.param("id"));
    const number = /^\d{1,4}$/.test(c.req.param("n")) ? Number(c.req.param("n")) : Number.NaN;
    const found = id.ok ? proposalVersion(deps.proposals, deps.actorOf(c.req.header("cookie") ?? ""), id.value, number) : null;
    if (!found || !found.ok) return c.text("Not found", 404);
    const body = deps.renderPdf(found.value);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(body.length),
        "content-disposition": `attachment; filename="${found.value.fileName}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
  return app;
}

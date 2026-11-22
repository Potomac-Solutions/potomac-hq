// v0.4's services against a real database: a proposal is drafted from a
// template, sent as versions that cannot change, accepted into a project with
// a baseline, and its signed agreement recorded.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import { projectOverview } from "../../src/projects/index.ts";
import * as proposals from "../../src/proposals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, addUser, count, events, PDF, testDb, unwrap, type TestDb } from "../support/harness.ts";

let t: TestDb;
let mikey: Id;
const accepted = { decision: "accepted", byName: "Ann Baker", on: "2026-11-18", method: "signed-paper", note: "Signed at the bakery." };

beforeEach(() => {
  t = testDb({ today: () => "2026-11-16" });
  mikey = addUser(t.db, "admin", "Mikey Nichols");
});
afterEach(() => t.close());

/** A client with an opportunity at the given stage. */
function opportunityAt(stage: "new" | "consulted", service = "application") {
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Mt. Storm Bakery", sizeTier: "small" }));
  unwrap(crm.addContact(t.services.crm, mikey, client.id, { name: "Ann Baker", email: "ann@example.com", isPrimary: true }));
  const opportunity = unwrap(crm.createOpportunity(t.services.crm, mikey, client.id, { title: "Bakery ordering app", leadSource: "word-of-mouth", service }));
  if (stage === "consulted") for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(t.services.crm, mikey, opportunity.id, { to }));
  return { client, opportunity };
}

test("draft from the service's template, send, revise, send again, accept: the opportunity is won and the project has its baseline", () => {
  const deps = t.services.proposals;
  const { opportunity, client } = opportunityAt("consulted");

  const draft = unwrap(proposals.startProposal(deps, mikey, opportunity.id, {}));
  assert.equal(draft.title, "Bakery ordering app");
  assert.equal(draft.pricing, "fixed", "the application template is fixed price");
  assert.equal(draft.lines.length, 3);

  const v1 = unwrap(proposals.sendProposalVersion(deps, mikey, draft.id));
  assert.deepEqual([v1.number, v1.total.minor, v1.minutes], [1, 240000, 1920]);
  let stored = t.services.crm.opportunities.get(opportunity.id);
  assert.deepEqual([stored?.stage, stored?.pricing, stored?.value?.minor], ["quoted", "fixed", 240000], "a sent proposal is the quote");
  assert.deepEqual(proposals.sendProposalVersion(deps, mikey, draft.id), { ok: false, error: "already-sent" });

  const revised = unwrap(
    proposals.saveProposal(deps, mikey, draft.id, {
      title: "Bakery ordering app",
      pricing: "fixed",
      scope: "Orders and pickup times.\n- Order ahead\n- Kitchen screen",
      lines: [{ item: "Design", kind: "hours", quantity: "6", rate: "75" }, { item: "Build", kind: "hours", quantity: "18", rate: "75" }, { item: "", kind: "hours", quantity: "", rate: "" }],
    }),
  );
  assert.equal(revised.status, "revised");
  assert.deepEqual(proposals.recordProposalDecision(deps, mikey, draft.id, accepted), { ok: false, error: "revised-not-sent" });
  const v2 = unwrap(proposals.sendProposalVersion(deps, mikey, draft.id));
  assert.deepEqual([v2.number, v2.total.minor], [2, 180000]);
  assert.equal(t.services.crm.opportunities.get(opportunity.id)?.value?.minor, 180000, "the opportunity follows the latest version");
  assert.equal(deps.proposals.version(draft.id, 1)?.total.minor, 240000, "version 1 still says what it said");
  assert.throws(() => t.db.prepare("update proposal_version set total_minor = 1 where proposal_id = ?").run(draft.id), /immutable/);
  assert.throws(() => t.db.prepare("delete from proposal_version where proposal_id = ?").run(draft.id), /immutable/);

  const answer = unwrap(proposals.recordProposalDecision(deps, mikey, draft.id, accepted));
  assert.deepEqual({ v: answer.decision.version, who: answer.decision.byName, how: answer.decision.method }, { v: 2, who: "Ann Baker", how: "signed-paper" });
  assert.ok(answer.project);
  stored = t.services.crm.opportunities.get(opportunity.id);
  assert.equal(stored?.stage, "won");
  assert.equal(t.services.crm.clients.get(client.id)?.status, "active");
  assert.equal(answer.project.name, "Bakery ordering app");

  const baseline = deps.baselines.get(answer.project.id);
  assert.deepEqual({ proposal: baseline?.proposalId, version: baseline?.version, amount: baseline?.amount.minor, minutes: baseline?.minutes, lines: baseline?.lines.map((l) => [l.item, l.total.minor]) }, {
    proposal: draft.id,
    version: 2,
    amount: 180000,
    minutes: 1440,
    lines: [["Design", 45000], ["Build", 135000]],
  });
  const overview = unwrap(projectOverview(t.services.projects, mikey, answer.project.id));
  assert.deepEqual({ amount: overview.baseline?.amount, hours: overview.baseline?.hours, lines: overview.baseline?.lines.map((l) => [l.item, l.quantity, l.total]) }, {
    amount: "$1,800.00",
    hours: "24",
    lines: [["Design", "6 h", "$450.00"], ["Build", "18 h", "$1,350.00"]],
  });
  assert.ok(overview.history.some((h) => h.text === "Mikey Nichols set the project’s baseline from a proposal"));

  // Closed for good.
  assert.deepEqual(proposals.saveProposal(deps, mikey, draft.id, { title: "x", pricing: "fixed", lines: [] }), { ok: false, error: "closed" });
  assert.deepEqual(proposals.recordProposalDecision(deps, mikey, draft.id, accepted), { ok: false, error: "closed" });

  const tail = actions(t.db).slice(-7);
  assert.deepEqual(tail, ["opportunity.stage-changed", "client.status-changed", "opportunity.converted", "project.created", "project.baseline-set", "proposal.accepted", "invoice.drafted-from-proposal"]);
  assert.equal(count(t.db, "proposal_version"), 2);
});

test("a proposal cannot be sent before the consult, or for a closed opportunity", () => {
  const deps = t.services.proposals;
  const { opportunity } = opportunityAt("new");
  const draft = unwrap(proposals.startProposal(deps, mikey, opportunity.id, { template: "website" }));
  assert.equal(draft.pricing, "monthly");
  assert.deepEqual(proposals.sendProposalVersion(deps, mikey, draft.id), { ok: false, error: "not-consulted-yet" });
  assert.equal(count(t.db, "proposal_version"), 0);
  assert.equal(unwrap(proposals.proposalDetail(deps, mikey, draft.id)).sendBlocked, "Move the opportunity to Consulted before sending a proposal.");

  unwrap(crm.moveOpportunity(t.services.crm, mikey, opportunity.id, { to: "lost", lostReason: "Went elsewhere." }));
  assert.deepEqual(proposals.sendProposalVersion(deps, mikey, draft.id), { ok: false, error: "opportunity-closed" });
  assert.deepEqual(proposals.startProposal(deps, mikey, opportunity.id, {}), { ok: false, error: "opportunity-closed" });
});

test("a monthly plan: the opportunity carries the monthly price, the project is ongoing", () => {
  const deps = t.services.proposals;
  const { opportunity } = opportunityAt("consulted", "website");
  const draft = unwrap(proposals.startProposal(deps, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(deps, mikey, draft.id));
  const stored = t.services.crm.opportunities.get(opportunity.id);
  assert.deepEqual([stored?.pricing, stored?.value?.minor], ["monthly", 5000]);
  const answer = unwrap(proposals.recordProposalDecision(deps, mikey, draft.id, accepted));
  assert.equal(answer.project?.kind, "ongoing");
  assert.equal(unwrap(projectOverview(t.services.projects, mikey, answer.project?.id as Id)).baseline?.amount, "$50.00 a month");
  const detail = unwrap(proposals.proposalDetail(deps, mikey, draft.id));
  assert.equal(detail.summary.deposit, "", "only a fixed quote has a deposit");
});

test("a declined proposal changes nothing else, and a new one can be started", () => {
  const deps = t.services.proposals;
  const { opportunity } = opportunityAt("consulted");
  const draft = unwrap(proposals.startProposal(deps, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(deps, mikey, draft.id));
  const answer = unwrap(proposals.recordProposalDecision(deps, mikey, draft.id, { ...accepted, decision: "declined", method: "phone" }));
  assert.equal(answer.project, null);
  assert.equal(t.services.crm.opportunities.get(opportunity.id)?.stage, "quoted");
  assert.equal(count(t.db, "project"), 0);
  assert.equal(actions(t.db).at(-1), "proposal.declined");
  const again = unwrap(proposals.startProposal(deps, mikey, opportunity.id, {}));
  const list = proposals.proposalsFor(deps, mikey, opportunity.id);
  assert.deepEqual(list.items.map((item) => [item.id, item.statusLabel]), [[again.id, "Draft"], [draft.id, "Declined"]]);
});

test("the signed agreement: where it is kept, or a scan, for an accepted proposal only", () => {
  const deps = t.services.proposals;
  const { opportunity, client } = opportunityAt("consulted");
  const draft = unwrap(proposals.startProposal(deps, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(deps, mikey, draft.id));
  assert.deepEqual(proposals.recordAgreement(deps, mikey, draft.id, { reference: "Filing cabinet", signedOn: "2026-11-18" }), { ok: false, error: "not-accepted" });
  unwrap(proposals.recordProposalDecision(deps, mikey, draft.id, accepted));

  assert.deepEqual(proposals.recordAgreement(deps, mikey, draft.id, { reference: " ", signedOn: "2026-11-18" }), { ok: false, error: "agreement-needs-reference" });
  assert.deepEqual(proposals.recordAgreement(deps, mikey, draft.id, { reference: "x", signedOn: "soon" }), { ok: false, error: "invalid-date" });
  assert.deepEqual(proposals.recordAgreement(deps, mikey, draft.id, { signedOn: "2026-11-18", file: { name: "signed.exe", bytes: PDF } }), { ok: false, error: "file-type-not-allowed" });
  assert.equal(count(t.db, "agreement"), 0);

  unwrap(proposals.recordAgreement(deps, mikey, draft.id, { reference: "Filing cabinet, Bakery folder", signedOn: "2026-11-18" }));
  const scanned = unwrap(proposals.recordAgreement(deps, mikey, draft.id, { signedOn: "2026-11-18", file: { name: "signed.pdf", bytes: PDF } }));
  assert.ok(scanned.fileId);
  const file = deps.files.get(scanned.fileId);
  assert.deepEqual({ owner: file?.ownerType, organization: file?.organizationId, visible: file?.clientVisible }, { owner: "agreement", organization: client.id, visible: false });
  const detail = unwrap(proposals.proposalDetail(deps, mikey, draft.id));
  assert.deepEqual(detail.agreements.map((a) => [a.reference, a.fileName, a.version]), [["", "signed.pdf", 1], ["Filing cabinet, Bakery folder", "", 1]]);
  assert.deepEqual(events(t.db).filter((e) => e.action === "agreement.recorded").map((e) => e.context["hasFile"]), [false, true]);
});

test("the document a client reads: sections as blocks, lines, totals and the deposit", () => {
  const deps = t.services.proposals;
  const { opportunity } = opportunityAt("consulted");
  const draft = unwrap(proposals.startProposal(deps, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(deps, mikey, draft.id));
  const doc = unwrap(proposals.proposalVersion(deps, mikey, draft.id, 1));
  assert.deepEqual({ title: doc.title, client: doc.clientName, contact: doc.contactName, by: doc.sentBy, file: doc.fileName }, { title: "Bakery ordering app", client: "Mt. Storm Bakery", contact: "Ann Baker", by: "Mikey Nichols", file: "Bakery-ordering-app-proposal-v1.pdf" });
  assert.deepEqual(doc.sections.map((s) => s.heading), ["Scope", "Deliverables", "Assumptions", "Not included"]);
  assert.ok(doc.sections[1]?.blocks.every((b) => b.bullet));
  assert.deepEqual(doc.lines.map((l) => [l.item, l.quantityLabel, l.rate, l.total]), [["Design", "8 h", "$75.00", "$600.00"], ["Build", "20 h", "$75.00", "$1,500.00"], ["Testing and launch", "4 h", "$75.00", "$300.00"]]);
  assert.deepEqual({ price: doc.summary.price, hours: doc.summary.hours, deposit: doc.summary.deposit, balance: doc.summary.balance }, { price: "$2,400.00", hours: "32", deposit: "$800.00", balance: "$1,600.00" });
  assert.deepEqual(proposals.proposalVersion(deps, mikey, draft.id, 2), { ok: false, error: "not-found" });
  assert.deepEqual(proposals.proposalVersion(deps, mikey, draft.id, Number.NaN), { ok: false, error: "not-found" });

  const pdf = t.services.renderProposalPdf(doc);
  assert.equal(new TextDecoder().decode(pdf.slice(0, 8)), "%PDF-1.4");
  assert.match(new TextDecoder().decode(pdf.slice(-6)), /%%EOF/);
});

test("sharing with the client is a switch, only once something has been sent", () => {
  const deps = t.services.proposals;
  const { opportunity, client } = opportunityAt("consulted");
  const draft = unwrap(proposals.startProposal(deps, mikey, opportunity.id, {}));
  assert.deepEqual(proposals.setProposalShared(deps, mikey, draft.id, true), { ok: false, error: "not-sent" });
  unwrap(proposals.sendProposalVersion(deps, mikey, draft.id));
  assert.deepEqual(deps.proposals.sharedWith(client.id), []);
  unwrap(proposals.setProposalShared(deps, mikey, draft.id, true));
  assert.deepEqual(deps.proposals.sharedWith(client.id).map((p) => p.id), [draft.id]);
  assert.deepEqual(proposals.setProposalShared(deps, mikey, draft.id, true), { ok: false, error: "unchanged" });
  unwrap(proposals.setProposalShared(deps, mikey, draft.id, false));
  assert.deepEqual(deps.proposals.sharedWith(client.id), []);
});

test("a member holds none of the proposal permissions, and sees no panel", () => {
  const deps = t.services.proposals;
  const { opportunity } = opportunityAt("consulted");
  const draft = unwrap(proposals.startProposal(deps, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(deps, mikey, draft.id));
  const before = count(t.db, "activity_event");

  for (const actor of [addUser(t.db, "member", "Sam Helper"), addUser(t.db, null), null]) {
    const refused: { ok: boolean; error?: string }[] = [
      proposals.startProposal(deps, actor, opportunity.id, {}),
      proposals.saveProposal(deps, actor, draft.id, { title: "x", pricing: "fixed", lines: [] }),
      proposals.sendProposalVersion(deps, actor, draft.id),
      proposals.recordProposalDecision(deps, actor, draft.id, accepted),
      proposals.recordAgreement(deps, actor, draft.id, { reference: "x", signedOn: "2026-11-18" }),
      proposals.setProposalShared(deps, actor, draft.id, true),
      proposals.listProposals(deps, actor),
      proposals.proposalDetail(deps, actor, draft.id),
      proposals.proposalVersion(deps, actor, draft.id, 1),
    ];
    refused.forEach((answer, index) => assert.deepEqual(answer, { ok: false, error: "forbidden" }, `call ${index}`));
    assert.deepEqual(proposals.proposalsFor(deps, actor, opportunity.id), { canView: false, canStart: false, templates: [], suggested: "blank", items: [] });
  }
  assert.equal(count(t.db, "activity_event"), before);

  // A manager holds all four.
  const manager = addUser(t.db, "manager", "Pat Manager");
  assert.equal(proposals.recordProposalDecision(deps, manager, draft.id, accepted).ok, true);
});

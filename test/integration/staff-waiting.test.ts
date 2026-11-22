// The top of the dashboard: what clients are waiting on Potomac for.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import * as portal from "../../src/portal/index.ts";
import * as projects from "../../src/projects/index.ts";
import * as proposals from "../../src/proposals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, PDF, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
let rosa: Client;
let projectId = "";
let deliverableId = "";

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const made = await wonProject(t.services, mikey, { client: "Elk River Diner", title: "Diner website" });
  projectId = made.project.id;
  const deliverable = unwrap(projects.addDeliverable(t.services.projects, mikey, made.project.id, { title: "Menu page", file: { name: "menu.pdf", bytes: PDF } }));
  unwrap(projects.setDeliverableShared(t.services.projects, mikey, deliverable.id, true));
  deliverableId = deliverable.id;
  rosa = await clientSignedIn(t, admin, made.client.id, "Rosa Alvarez", "rosa@diner.example");
});
after(() => t.stop());

test("with nothing waiting, the dashboard says so in one line", async () => {
  const page = textOf(await admin.page("/"));
  assert.match(page, /Dashboard No client is waiting on you Unanswered messages, changes asked for, calls to return and invoices to send or chase show here first\./);
  assert.match(page, /Follow-ups due Nothing due today\./);
});

test("a message, changes asked for and a call come first, each with where to go, and go away once handled", async () => {
  await rosa.submit(`/portal/projects/${projectId}/messages`, { body: "Can we add brunch hours?" });
  await rosa.submit(`/portal/deliverables/${deliverableId}/decision`, { decision: "changes-requested", note: "Prices are from last year", projectId });
  await rosa.submit("/portal/calls", { wanted: "Monday, we are closed", phone: "304-555-0101" });
  const html = await admin.page("/");
  const page = textOf(html);
  assert.match(page, /3 things clients are waiting on Answer Rosa Alvarez on Diner website Elk River Diner\. Their message is the last word on the project\. Reply/);
  assert.match(page, /Changes asked for on “Menu page” Diner website, Elk River Diner: “Prices are from last year” Open/);
  assert.match(page, /Call Rosa Alvarez back Elk River Diner\. Wants: Monday, we are closed\. On 304-555-0101\. Answer/);
  assert.ok(html.indexOf("waiting-on-you") < html.indexOf("follow-ups-due"), "it is the first panel");
  assert.match(html, new RegExp(`href="/projects/${projectId}#updates"`));

  // A reply on the project answers the message.
  await admin.submit(`/projects/${projectId}/updates`, { body: "Yes, brunch hours are going on the home page." });
  assert.doesNotMatch(textOf(await admin.page("/")), /Answer Rosa Alvarez/);
  // Sharing a new version answers the changes. Answering the call answers the call.
  unwrap(projects.setDeliverableShared(t.services.projects, mikey, deliverableId as Id, true));
  const call = t.services.portal.calls.waiting()[0];
  assert.ok(call);
  unwrap(portal.answerCallRequest(t.services.portal, mikey, call.id, { answer: "confirmed", confirmedFor: "Monday 10 AM", reply: "" }));
  assert.match(textOf(await admin.page("/")), /No client is waiting on you/);
});

test("an accepted proposal's drafted deposit is waiting to be sent, and an invoice past due is waiting to be chased", async () => {
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Canaan Valley Inn" }));
  const opportunity = unwrap(crm.createOpportunity(t.services.crm, mikey, client.id, { title: "Booking site", leadSource: "phone", service: "application" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(t.services.crm, mikey, opportunity.id, { to }));
  const proposal = unwrap(proposals.startProposal(t.services.proposals, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(t.services.proposals, mikey, proposal.id));
  unwrap(proposals.recordProposalDecision(t.services.proposals, mikey, proposal.id, { decision: "accepted", byName: "Lee", on: t.services.today(), method: "email" }));
  const page = textOf(await admin.page("/"));
  assert.match(page, /1 thing a client is waiting on Send invoice INV-0001 Booking site, Canaan Valley Inn\. \$800\.00, still a draft\. Check and send/);

  const draft = t.services.finance.invoices.list()[0];
  assert.ok(draft);
  unwrap(finance.sendInvoiceNow(t.services.finance, mikey, draft.id));
  assert.match(textOf(await admin.page("/")), /No client is waiting on you/, "sent and not yet due: nothing to do");
  const late = unwrap(finance.createInvoice(t.services.finance, mikey, projectId as Id, { kind: "other", description: "Photos", amount: "120", dueOn: "2026-01-02" }));
  unwrap(finance.sendInvoiceNow(t.services.finance, mikey, late.id));
  assert.match(textOf(await admin.page("/")), /Invoice INV-0002 is past due Diner website, Elk River Diner\. \$120\.00 owed, due Fri, Jan 2, [\d,]+ days ago\. Open/);
});

test("a member sees only what they can act on", async () => {
  const member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  const page = textOf(await member.page("/"));
  assert.doesNotMatch(page, /INV-|past due|Send invoice/, "money is for those who may change invoices");
  assert.match(page, /No client is waiting on you/);
});

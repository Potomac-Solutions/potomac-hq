// v0.6 over real HTTP: inviting a client, their one-time link, and what they
// do in the portal: approve a deliverable, answer a proposal by typing their
// name, send a message and ask for a call.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as projects from "../../src/projects/index.ts";
import * as proposals from "../../src/proposals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, httpClient, PASSWORD, PDF, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
let clientId = "";
let projectId = "";
let deliverableId = "";
let proposalId = "";
let ann: Client;
const sent: { to: string; subject: string; body: string }[] = [];

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example" });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const made = await wonProject(t.services, mikey);
  clientId = made.client.id;
  projectId = made.project.id;
  unwrap(projects.addMilestone(t.services.projects, mikey, made.project.id, { name: "Design signed off", dueOn: "2099-12-05" }));
  const deliverable = unwrap(projects.addDeliverable(t.services.projects, mikey, made.project.id, { title: "Home page design", file: { name: "design.pdf", bytes: PDF } }));
  unwrap(projects.setDeliverableShared(t.services.projects, mikey, deliverable.id, true));
  deliverableId = deliverable.id;
  const opportunity = unwrap(crm.createOpportunity(t.services.crm, mikey, made.client.id, { title: "Online ordering", leadSource: "phone", service: "application" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(t.services.crm, mikey, opportunity.id, { to }));
  const proposal = unwrap(proposals.startProposal(t.services.proposals, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(t.services.proposals, mikey, proposal.id));
  unwrap(proposals.setProposalShared(t.services.proposals, mikey, proposal.id, true));
  proposalId = proposal.id;
});
after(() => t.stop());

test("an invite shows the inviter a one-time link, which is never stored, logged or sent on", async () => {
  assert.match(await admin.page(`/clients/${clientId}`), /Nobody at this client has been invited yet\./);
  assert.match((await admin.submit(`/clients/${clientId}/portal-users`, { name: "Ann Baker", email: "not-an-email" })).html, /Enter an email address/);

  const invited = await admin.post(`/clients/${clientId}/portal-users`, { name: "Ann Baker", email: "Ann@Bakery.example" });
  assert.equal(invited.status, 200);
  assert.equal(invited.headers.get("cache-control"), "no-store");
  assert.equal(invited.headers.get("referrer-policy"), "no-referrer");
  const html = await invited.text();
  assert.match(html, /Send this link to Ann Baker/);
  const link = /value="(https:\/\/hq\.example\/portal\/accept\?token=[A-Za-z0-9_-]{43})"/.exec(html)?.[1] ?? "";
  assert.ok(link, "the link carries the public address");
  const token = new URL(link).searchParams.get("token") ?? "";
  assert.ok(!JSON.stringify(events(t.db)).includes(token), "the link is not in the audit log");
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Ann Baker ann@bakery\.example Invited, not signed in yet/);
  assert.match((await admin.submit(`/clients/${clientId}/portal-users`, { name: "Ann Again", email: "ann@bakery.example" })).html, /already has a portal invite or account/);

  // The link's page, and a password that is too short.
  const visitor = httpClient(t.origin);
  const page = await visitor.page(`/portal/accept?token=${token}`);
  assert.match(page, /Welcome to your client portal/);
  assert.match(page, /ann@bakery\.example/);
  assert.match(await visitor.page("/portal/accept?token=nonsense"), /This link can’t be used/);
  const short = await visitor.post("/portal/accept", { token, name: "Ann Baker", password: "short" });
  assert.match(new URL(t.origin + (short.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /at least 10 characters/);
  assert.equal((await visitor.get("/portal")).status, 401);

  // It works once.
  const accepted = await visitor.post("/portal/accept", { token, name: "Ann Baker", password: PASSWORD });
  assert.match(accepted.headers.get("location") ?? "", /^\/portal\?done=/);
  assert.match(await visitor.page("/portal"), /<h1>Mt\. Storm Bakery<\/h1>/);
  const again = await httpClient(t.origin).post("/portal/accept", { token, name: "Mallory", password: "another long password" });
  assert.match(new URL(t.origin + (again.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /expired or been used/);
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Ann Baker ann@bakery\.example Has access/);

  // Sign out, then back in with the password.
  assert.match((await visitor.post("/portal/sign-out", {})).headers.get("location") ?? "", /^\/portal\/sign-in\?done=/);
  assert.equal((await visitor.get("/portal")).status, 401);
  const wrong = await visitor.post("/portal/sign-in", { email: "ann@bakery.example", password: "not the password" });
  assert.match(new URL(t.origin + (wrong.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /don’t match/);
  assert.equal((await visitor.post("/portal/sign-in", { email: "ann@bakery.example", password: PASSWORD })).headers.get("location"), "/portal");
  ann = visitor;

  const recorded = events(t.db).filter((e) => e.action.startsWith("client-user.")).map((e) => [e.actor === mikey ? "mikey" : e.actor, e.action]);
  assert.deepEqual(recorded, [["mikey", "client-user.invited"], [null, "client-user.password-set"], [null, "client-user.signed-out"], [null, "client-user.signed-in"]]);
});

test("the client follows a project, asks for changes to a deliverable, then approves the next share", async () => {
  const page = await ann.page(`/portal/projects/${projectId}`);
  assert.match(textOf(page), /On track Next: Design signed off, Sat, Dec 5, 2099, in \d+ days/);
  assert.doesNotMatch(page, /Billable hours/, "no hours line until some are logged");
  assert.match(textOf(page), /Home page design Waiting for your decision Open design\.pdf/);

  const blank = await ann.submit(`/portal/deliverables/${deliverableId}/decision`, { decision: "changes-requested", note: " ", projectId });
  assert.match(blank.html, /Say what you would like changed\./);
  const changes = await ann.submit(`/portal/deliverables/${deliverableId}/decision`, { decision: "changes-requested", note: "A bigger logo, please.", projectId });
  assert.match(changes.html, /Your decision is recorded\./);
  assert.match(textOf(changes.html), /Changes requested : “A bigger logo, please\.”/);

  // Potomac sees it, posts an update and shares it again.
  const staff = textOf(await admin.page(`/projects/${projectId}`));
  assert.match(staff, /Changes requested “A bigger logo, please\.”/);
  assert.match(staff, /The client asked for changes to a deliverable/);
  assert.match((await admin.submit(`/projects/${projectId}/updates`, { body: "Logo is bigger. Have another look." })).html, /Update posted\./);
  await admin.submit(`/deliverables/${deliverableId}/share`, { projectId });

  const second = await ann.page(`/portal/projects/${projectId}`);
  assert.match(textOf(second), /Logo is bigger\. Have another look\. Mikey Nichols, Potomac Solutions/);
  const approved = await ann.submit(`/portal/deliverables/${deliverableId}/decision`, { decision: "approved", projectId });
  assert.match(textOf(approved.html), /Approved by you/);
  assert.match((await ann.submit(`/portal/deliverables/${deliverableId}/decision`, { decision: "approved", projectId })).html, /That has already been decided\./);

  const decided = events(t.db).filter((e) => e.action.startsWith("deliverable.") && e.actor === null);
  assert.deepEqual(decided.map((e) => e.action), ["deliverable.changes-requested", "deliverable.approved"]);
  assert.ok(decided.every((e) => e.context["projectId"] === projectId && typeof e.context["clientUserId"] === "string"));
  assert.equal(t.db.prepare("select decided_by_client from deliverable where id = ?").get(deliverableId)?.["decided_by_client"], decided[1]?.context["clientUserId"]);

  // A message back, which Potomac reads on the project.
  assert.match((await ann.submit(`/portal/projects/${projectId}/messages`, { body: "Looks great. When do we launch?" })).html, /Message sent to Potomac Solutions\./);
  assert.match(textOf(await admin.page(`/projects/${projectId}`)), /Looks great\. When do we launch\? From the client Ann Baker/);
  assert.doesNotMatch(await ann.page(`/portal/projects/${projectId}`), /Notes/, "internal notes have no place in the portal");
});

test("the client accepts a proposal by typing their name: the same thing happens as when Potomac records it", async () => {
  const page = await ann.page(`/portal/proposals/${proposalId}`);
  assert.match(page, /<h1>Online ordering<\/h1>/);
  assert.match(textOf(page), /A deposit of \$800\.00, one third of the total/);
  const unsigned = await ann.submit(`/portal/proposals/${proposalId}/answer`, { decision: "accepted", typedName: "  " });
  assert.match(unsigned.html, /Type your full name to give your answer\./);

  const accepted = await ann.submit(`/portal/proposals/${proposalId}/answer`, { decision: "accepted", typedName: "Ann M. Baker" });
  assert.match(accepted.html, /Your answer is recorded\./);
  assert.match(textOf(accepted.html), /Accepted \. Accepted by Ann M\. Baker on \d{4}-\d{2}-\d{2}, version 1\./);
  assert.doesNotMatch(accepted.html, /Send my answer/);

  const decision = t.services.proposals.proposals.decision(proposalId as Id);
  assert.deepEqual({ who: decision?.byName, how: decision?.method, by: decision?.recordedBy, version: decision?.version }, { who: "Ann M. Baker", how: "portal", by: null, version: 1 });
  const home = textOf(await ann.page("/portal"));
  assert.match(home, /Online ordering On track/, "the accepted work is now one of their projects");
  const staff = textOf(await admin.page(`/proposals/${proposalId}`));
  assert.match(staff, /Answer Accepted by Ann M\. Baker on \d{4}-\d{2}-\d{2}, version 1\. In the client portal\./);
  const portalEvent = events(t.db).find((e) => e.action === "proposal.accepted-in-portal");
  assert.deepEqual({ actor: portalEvent?.actor, name: portalEvent?.context["typedName"] }, { actor: null, name: "Ann M. Baker" });
});

test("a call is asked for in the portal and answered from the client's page", async () => {
  assert.match((await ann.submit("/portal/calls", { wanted: "Thursday afternoon", note: "The menu page" })).html, /Request sent\./);
  assert.match(textOf(await admin.page("/")), /Call Ann Baker back Mt\. Storm Bakery\. Wants: Thursday afternoon\. Answer/);
  const request = t.services.portal.calls.waiting()[0];
  assert.ok(request);
  const missing = await admin.submit(`/call-requests/${request.id}/answer`, { answer: "confirmed", confirmedFor: "", reply: "", organizationId: clientId });
  assert.match(missing.html, /Enter the day and time you are confirming\./);
  const answered = await admin.submit(`/call-requests/${request.id}/answer`, { answer: "confirmed", confirmedFor: "Thursday Nov 19, 2:00 PM", reply: "Talk then.", organizationId: clientId });
  assert.match(answered.html, /Answer sent to the client’s portal\./);
  assert.match(textOf(await ann.page("/portal")), /You asked for: Thursday afternoon Confirmed for Thursday Nov 19, 2:00 PM \. “Talk then\.”/);
  assert.doesNotMatch(await admin.page("/"), /Call Ann Baker back/, "nothing is waiting any more");
});

test("with email set up, the link is emailed and not shown", async () => {
  const mailed = await testApp({
    passwordCost: TEST_PASSWORD_COST,
    publicUrl: "https://hq.example",
    email: { publicUrl: "https://hq.example", send: async (message) => (sent.push({ to: message.to, subject: message.subject, body: message.body }), { ok: true }) },
  });
  try {
    const boss = await signIn(mailed, "mikey@example.com", "Mikey Nichols", ["admin"]);
    await boss.get("/");
    const id = mailed.db.prepare("select id from user").get()?.["id"] as Id;
    const client = unwrap(crm.createClient(mailed.services.crm, id, { name: "Gormania Feed" }));
    const invited = await boss.post(`/clients/${client.id}/portal-users`, { name: "Bob Miller", email: "bob@feed.example" });
    assert.equal(invited.status, 303);
    assert.match(new URL(mailed.origin + (invited.headers.get("location") ?? "")).searchParams.get("done") ?? "", /A link was emailed to bob@feed\.example/);
    assert.equal(sent.length, 1);
    assert.deepEqual([sent[0]?.to, sent[0]?.subject], ["bob@feed.example", "Your Potomac Solutions client portal"]);
    assert.match(sent[0]?.body ?? "", /https:\/\/hq\.example\/portal\/accept\?token=[A-Za-z0-9_-]{43}/);
  } finally {
    await mailed.stop();
  }
});

test("a member sees who has portal access but cannot invite or switch it", async () => {
  const member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  const page = await member.page(`/clients/${clientId}`);
  assert.match(page, /Client portal/);
  assert.match(page, /ann@bakery\.example/);
  assert.doesNotMatch(page, /Invite someone to the portal|New link|Turn access off/);
  const refused = await member.post(`/clients/${clientId}/portal-users`, { name: "Eve", email: "eve@example.com" });
  assert.match(new URL(t.origin + (refused.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /permission/);
  assert.match((await member.submit(`/projects/${projectId}/updates`, { body: "Sam here with an update." })).html, /Update posted\./);
});

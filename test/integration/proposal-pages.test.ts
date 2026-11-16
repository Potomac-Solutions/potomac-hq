// v0.4 over real HTTP: a proposal from an opportunity's page to an accepted
// project, the PDF, and what a member is never sent.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { httpClient, idIn, PDF, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let opportunityId = "";
let proposalId = "";

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, mikey, { name: "Mt. Storm Bakery" }));
  const opportunity = unwrap(crm.createOpportunity(t.services.crm, mikey, client.id, { title: "Bakery ordering app", leadSource: "phone", service: "application" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(t.services.crm, mikey, opportunity.id, { to }));
  opportunityId = opportunity.id;
});
after(() => t.stop());

test("start a proposal from the opportunity, with the service's template suggested", async () => {
  const page = await admin.page(`/opportunities/${opportunityId}`);
  assert.match(page, /<h2 id="opportunity-proposals">Proposals<\/h2>/);
  assert.match(page, /<option value="application" selected[^>]*>Application development<\/option>/);
  assert.match(await admin.page("/proposals"), /No proposals yet/);

  const started = await admin.submit(`/opportunities/${opportunityId}/proposals`, { template: "application" });
  proposalId = idIn(started.location);
  assert.match(started.location, /^\/proposals\//);
  assert.match(started.html, /Proposal drafted\./);
  assert.match(textOf(started.html), /Status Draft Price \$2,400\.00 \(Fixed price\) Hours 32 Deposit \$800\.00, then \$1,600\.00/);
  assert.match(started.html, /name="item-0" value="Design"/);
  assert.match(started.html, /name="item-5" value=""/, "three empty rows follow the three lines");
});

test("edit the estimate, send it, read the version and download the PDF", async () => {
  const fields = {
    title: "Bakery ordering app",
    pricing: "fixed",
    scope: "Orders and pickup times.\n- Order ahead\n- Kitchen screen",
    deliverables: "- The working app",
    assumptions: "",
    exclusions: "",
    "item-0": "Design", "kind-0": "hours", "quantity-0": "6", "rate-0": "75.00",
    "item-1": "Build", "kind-1": "hours", "quantity-1": "18", "rate-1": "75",
    "item-2": "", "kind-2": "hours", "quantity-2": "", "rate-2": "",
    "item-3": "Stock photos", "kind-3": "quantity", "quantity-3": "3", "rate-3": "12.50",
  };
  const saved = await admin.submit(`/proposals/${proposalId}`, fields);
  assert.match(saved.html, /Proposal saved\./);
  assert.match(textOf(saved.html), /Price \$1,837\.50/);
  assert.match(saved.html, /name="item-2" value="Stock photos"/, "the empty row is dropped");

  const bad = await admin.submit(`/proposals/${proposalId}`, { ...fields, "rate-1": "lots" });
  assert.match(bad.html, /Enter a rate like 75\.00\./);

  const sent = await admin.submit(`/proposals/${proposalId}/send`, {});
  assert.match(sent.location, new RegExp(`^/proposals/${proposalId}/versions/1\\?done=`));
  const read = textOf(sent.html);
  assert.match(read, /Prepared for Mt\. Storm Bakery/);
  assert.match(read, /Version 1, sent .* by Mikey Nichols/);
  assert.match(read, /Scope Orders and pickup times\. Order ahead Kitchen screen/);
  assert.match(read, /Stock photos 3 \$12\.50 \$37\.50/);
  assert.match(read, /A deposit of \$612\.50, one third of the total/);
  assert.match(textOf(await admin.page(`/opportunities/${opportunityId}`)), /Stage Quoted .* Price \$1,837\.50 fixed price/, "the opportunity took the price and moved to quoted");

  const pdf = await admin.get(`/proposals/${proposalId}/versions/1/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.headers.get("content-disposition"), 'attachment; filename="Bakery-ordering-app-proposal-v1.pdf"');
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.ok(bytes.length > 1500);

  for (const path of [`/proposals/${proposalId}/versions/2/pdf`, `/proposals/${proposalId}/versions/x/pdf`, "/proposals/nope/versions/1/pdf"]) assert.equal((await admin.get(path)).status, 404, path);
  assert.equal((await admin.get(`/proposals/${proposalId}/versions/2`)).status, 404);
  assert.equal((await httpClient(t.origin).get(`/proposals/${proposalId}/versions/1/pdf`)).status, 404, "signed out, there is no PDF");
});

test("a long proposal fits, and a huge one is refused before it is read", async () => {
  const long = await admin.post(`/proposals/${proposalId}`, { title: "Bakery ordering app", pricing: "fixed", scope: "x".repeat(7000), deliverables: "y".repeat(7000), assumptions: "z".repeat(7000), exclusions: "", "item-0": "Build", "kind-0": "hours", "quantity-0": "24", "rate-0": "75" });
  assert.equal(long.status, 303);
  assert.match(new URL(t.origin + (long.headers.get("location") ?? "")).searchParams.get("done") ?? "", /Proposal saved\./);
  const huge = await admin.post(`/proposals/${proposalId}`, { title: "x", pricing: "fixed", scope: "x".repeat(200_000) });
  assert.equal(huge.status, 413);
  const elsewhere = await admin.post("/clients", { name: "x".repeat(20_000) });
  assert.equal(elsewhere.status, 413, "other forms keep the small limit");
});

test("record the answer and the signed agreement: the project starts with its baseline", async () => {
  const page = await admin.page(`/proposals/${proposalId}`);
  assert.match(page, /Changed since it was sent/);
  assert.doesNotMatch(page, /Record the client’s answer/, "a changed proposal must be sent again first");
  await admin.submit(`/proposals/${proposalId}/send`, {});
  assert.match(await admin.page(`/proposals/${proposalId}`), /Record the client’s answer/);

  const missing = await admin.submit(`/proposals/${proposalId}/decision`, { decision: "accepted", byName: "", on: "2026-11-18", method: "signed-paper" });
  assert.match(missing.html, /Enter who at the client gave the answer\./);

  const accepted = await admin.submit(`/proposals/${proposalId}/decision`, { decision: "accepted", byName: "Ann Baker", on: "2026-11-18", method: "signed-paper", note: "" });
  assert.match(accepted.location, /^\/projects\//);
  const project = textOf(accepted.html);
  assert.match(project, /Answer recorded\./);
  assert.match(project, /What was agreed \$1,800\.00 , 24 hours \. From the accepted proposal, version 2/);

  const scan = await admin.follow(await admin.upload(`/proposals/${proposalId}/agreement`, { signedOn: "2026-11-18", reference: "Filing cabinet" }, { field: "file", name: "signed.pdf", bytes: PDF }), "agreement");
  assert.match(scan.html, /Agreement recorded\./);
  assert.match(textOf(scan.html), /Signed 2026-11-18, version 2\. Filing cabinet signed\.pdf/);
  assert.match(textOf(scan.html), /Answer Accepted by Ann Baker on 2026-11-18, version 2\. Signed on paper\./);
  assert.doesNotMatch(scan.html, /Save proposal/, "an answered proposal has no editor");
  assert.match(await admin.page("/proposals"), /Accepted/);
});

test("a member is sent no proposal and no price", async () => {
  const member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  const opportunity = await member.page(`/opportunities/${opportunityId}`);
  assert.doesNotMatch(opportunity, /opportunity-proposals/);
  assert.doesNotMatch(opportunity, /1,800/);
  for (const path of ["/proposals", `/proposals/${proposalId}`, `/proposals/${proposalId}/versions/1`]) {
    const res = await member.get(path);
    assert.equal(res.status, 403, path);
    assert.doesNotMatch(await res.text(), /1,800|1,837|Bakery ordering/, path);
  }
  assert.equal((await member.get(`/proposals/${proposalId}/versions/1/pdf`)).status, 404);
  const projectId = idIn((await admin.page("/projects")).match(/href="\/projects\/[0-9a-f-]{36}"/)?.[0] ?? "");
  const project = await member.page(`/projects/${projectId}`);
  assert.match(project, /Bakery ordering app/);
  assert.doesNotMatch(project, /What was agreed|1,800/, "the baseline is a price, so a member does not get it");
});

// The portal as four clients use it: a farmer on a phone, a movie theater
// owner who works nights, a body shop owner who wants the price first, and
// a restaurant owner who needs to send a menu. Each test is one thing that
// client needed and could not do before.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import * as portal from "../../src/portal/index.ts";
import * as projects from "../../src/projects/index.ts";
import * as proposals from "../../src/proposals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, count, events, httpClient, PDF, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
let dale: Client;
let clientId = "";
let projectId = "";
let deliverableId = "";
let proposalId = "";
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const day = (n: number) => Temporal.PlainDate.from(t.services.today()).add({ days: n }).toString();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, contact: { phone: "304-555-0142", email: "hello@potomac.example", address: "PO Box 12, Gormania, WV 26720" } });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const s = t.services;
  const made = await wonProject(s, mikey, { client: "Hinkle Family Farm", title: "Farm stand website" });
  clientId = made.client.id;
  projectId = made.project.id;
  unwrap(projects.addMilestone(s.projects, mikey, made.project.id, { name: "Photos from you", dueOn: day(-2) }));
  unwrap(projects.addMilestone(s.projects, mikey, made.project.id, { name: "Design signed off", dueOn: day(5) }));
  const deliverable = unwrap(projects.addDeliverable(s.projects, mikey, made.project.id, { title: "Home page design", file: { name: "design.pdf", bytes: PDF } }));
  unwrap(projects.setDeliverableShared(s.projects, mikey, deliverable.id, true));
  deliverableId = deliverable.id;
  unwrap(portal.postProjectUpdate(s.portal, mikey, made.project.id, "The home page design is ready for you."));
  const invoice = unwrap(finance.createInvoice(s.finance, mikey, made.project.id, { kind: "deposit", description: "Deposit", amount: "800" }));
  unwrap(finance.sendInvoiceNow(s.finance, mikey, invoice.id));
  const opportunity = unwrap(crm.createOpportunity(s.crm, mikey, made.client.id, { title: "CSA ordering", leadSource: "phone", service: "application" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(s.crm, mikey, opportunity.id, { to }));
  const proposal = unwrap(proposals.startProposal(s.proposals, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(s.proposals, mikey, proposal.id));
  unwrap(proposals.setProposalShared(s.proposals, mikey, proposal.id, true));
  proposalId = proposal.id;
  dale = await clientSignedIn(t, admin, clientId, "Dale Hinkle", "dale@hinklefarm.example");
});
after(() => t.stop());

test("the first thing a client sees is what is waiting on them, each with one place to go", async () => {
  const html = await dale.page("/portal");
  const home = textOf(html);
  assert.match(home, /3 things are waiting on you Look at “Home page design” Farm stand website\. Approve it, or say what should change\. Open it/);
  assert.match(home, /Answer the proposal “CSA ordering” .* Read it/);
  assert.match(home, /Pay invoice INV-0001: \$800\.00 Farm stand website\. How to pay/);
  assert.match(html, new RegExp(`href="/portal/projects/${projectId}#deliverables"`));
  assert.match(html, new RegExp(`href="/portal/proposals/${proposalId}"`));
  assert.ok(html.indexOf("portal-attention") < html.indexOf("portal-projects"), "it comes before everything else");

  // Days read as days, and say how far off they are.
  assert.match(home, /Farm stand website On track Next: Photos from you, was due [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} 0 of 2 steps done/);
  assert.doesNotMatch(home, /\d{4}-\d{2}-\d{2}/, "no day is shown the way a database stores it");
  assert.match(home, /Latest from Potomac Solutions The home page design is ready for you\. Mikey Nichols on Farm stand website ?,/);
  assert.match(home, /Who can sign in for Hinkle Family Farm: Dale Hinkle\. To add or remove someone, ask Potomac Solutions\./);
});

test("Potomac's phone number is on every portal page, signed in or not, and a check has somewhere to go", async () => {
  for (const page of [await dale.page("/portal"), await dale.page(`/portal/projects/${projectId}`), await dale.page(`/portal/proposals/${proposalId}`), await (await httpClient(t.origin).get("/portal/sign-in")).text()]) {
    assert.match(page, /<a href="tel:304-555-0142">304-555-0142<\/a>/);
    assert.match(page, /<a href="mailto:hello@potomac\.example">/);
  }
  const home = textOf(await dale.page("/portal"));
  assert.match(home, /You owe \$800\.00 in all\. INV-0001 · Farm stand website \$800\.00 owed Download/);
  assert.match(home, /How to pay By check made out to Potomac Solutions ?, or in cash\. Write the invoice number on the check\. Mail it to: PO Box 12, Gormania, WV 26720/);

  // With no contact details set, nothing is invented.
  const bare = await testApp({ passwordCost: TEST_PASSWORD_COST });
  try {
    const page = await (await httpClient(bare.origin).get("/portal/sign-in")).text();
    assert.doesNotMatch(page, /Rather talk to a person|tel:|Mail it to/);
  } finally {
    await bare.stop();
  }
});

test("a project's steps are a checklist with real days, and a late one says so", async () => {
  const page = textOf(await dale.page(`/portal/projects/${projectId}`));
  assert.match(page, /Where it stands On track Next: Photos from you, was due/);
  assert.match(page, /0 of 2 steps done Photos from you \(not done yet\) Was due [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, 2 days ago Design signed off \(not done yet\) [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, in 5 days/);
  const first = t.db.prepare("select id from milestone where name = 'Photos from you'").get()?.["id"] as Id;
  unwrap(projects.setMilestoneDone(t.services.projects, mikey, first, true));
  const after = textOf(await dale.page(`/portal/projects/${projectId}`));
  assert.match(after, /1 of 2 steps done ✓ Photos from you \(done\) Done [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}/);
  assert.match(await dale.page(`/portal/projects/${projectId}`), /<progress max="2" value="1"/);
});

test("a client sends a photo and a menu, gets them back, and Potomac sees them on the project", async () => {
  const page = await dale.page(`/portal/projects/${projectId}`);
  assert.match(page, /<form method="post" action="\/portal\/projects\/[0-9a-f-]{36}\/files" enctype="multipart\/form-data"/);
  assert.match(textOf(page), /Send us a file .* Photos \(JPG or PNG\), PDFs, and Word or Excel files, up to 25 MB each\. One at a time\./);

  const photo = await dale.upload(`/portal/projects/${projectId}/files`, {}, { field: "file", name: "C:\\Users\\Dale\\farm stand.jpg", bytes: JPEG });
  assert.match(photo.headers.get("location") ?? "", new RegExp(`^/portal/projects/${projectId}\\?done=`));
  const sent = await dale.follow(photo, `/portal/projects/${projectId}`);
  assert.match(sent.html, /File sent to Potomac Solutions\./);
  assert.match(textOf(sent.html), /farm stand\.jpg 20 bytes · sent by Dale Hinkle,/);
  await dale.upload(`/portal/projects/${projectId}/files`, {}, { field: "file", name: "prices.pdf", bytes: PDF });

  const id = t.db.prepare("select id from file where name = 'farm stand.jpg'").get()?.["id"] as string;
  const back = await dale.get(`/portal/files/${id}`);
  assert.equal(back.status, 200);
  assert.match(back.headers.get("content-disposition") ?? "", /^attachment/, "always a download, never shown in the page");
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), JPEG);

  const staff = textOf(await admin.page(`/projects/${projectId}`));
  assert.match(staff, /Files from the client .* prices\.pdf .* Dale Hinkle, .* farm stand\.jpg 20 bytes · Dale Hinkle,/);
  assert.equal((await admin.get(`/files/${id}`)).status, 200);
  const received = events(t.db).filter((e) => e.action === "file.received-from-client");
  assert.equal(received.length, 2);
  assert.deepEqual([received[0]?.actor, received[0]?.context["projectId"], received[0]?.context["name"]], [null, projectId, "farm stand.jpg"]);
  assert.match(textOf(await admin.page(`/projects/${projectId}`)), /A client sent a file/);
});

test("a file that is not what it says, is the wrong kind, or is one too many is refused in plain words", async () => {
  const before = count(t.db, "file");
  const send = (name: string, bytes: Uint8Array) => dale.upload(`/portal/projects/${projectId}/files`, {}, { field: "file", name, bytes });
  assert.match(problemOf(await send("virus.exe", new Uint8Array([0x4d, 0x5a, 1, 2]))), /That kind of file can’t be sent here/);
  assert.match(problemOf(await send("photo.jpg", new TextEncoder().encode("<script>alert(1)</script>"))), /isn’t what its name says it is/);
  assert.match(problemOf(await send("page.html", new TextEncoder().encode("<html></html>"))), /That kind of file/);
  assert.equal(count(t.db, "file"), before);

  // No more than twenty in a day on one project.
  const session = { clientUserId: t.db.prepare("select id from client_user").get()?.["id"] as Id, organizationId: clientId as Id, name: "Dale Hinkle" };
  for (let n = count(t.db, "file") - 1; n < 20; n++) unwrap(portal.sendFile(t.services.portal, session, projectId as Id, { name: `photo-${n}.jpg`, bytes: JPEG }));
  assert.match(problemOf(await send("one-more.jpg", JPEG)), /a lot of files for one day/);

  // A finished project takes no more files, and says to send a message.
  const made = await wonProject(t.services, mikey, { client: "Hinkle Orchard", title: "Old site" });
  t.db.prepare("update project set organization_id = ? where id = ?").run(clientId, made.project.id);
  unwrap(projects.setProjectStatus(t.services.projects, mikey, made.project.id, "completed"));
  assert.match(problemOf(await dale.upload(`/portal/projects/${made.project.id}/files`, {}, { field: "file", name: "late.jpg", bytes: JPEG })), /This project is finished/);
  assert.match(await dale.page(`/portal/projects/${made.project.id}`), /This project is finished, so files can’t be added to it\./);
});

test("a message can be sent from the home page, about the right project", async () => {
  const home = await dale.page("/portal");
  assert.match(home, /<form method="post" action="\/portal\/messages"/);
  const sent = await dale.submit("/portal/messages", { projectId, body: "The stand opens May 1. Can the site be up by then?" });
  assert.match(sent.html, /Message sent to Potomac Solutions\./);
  assert.match(textOf(await admin.page(`/projects/${projectId}`)), /The stand opens May 1\. Can the site be up by then\? From the client Dale Hinkle/);
  assert.match(problemOf(await dale.post("/portal/messages", { projectId: "not-an-id", body: "x" })), /doesn’t exist/);
  assert.match(problemOf(await dale.post("/portal/messages", { projectId, body: "  " })), /Write the message first/);
});

test("asking for a call takes a number to call back on, and Potomac sees it", async () => {
  assert.match(problemOf(await dale.post("/portal/calls", { wanted: "After dark", phone: "call me maybe" })), /doesn’t look like a phone number/);
  const asked = await dale.submit("/portal/calls", { wanted: "After dark, or any time it rains", phone: "(304) 555-0199 ext 2", note: "Prices for the site" });
  assert.match(asked.html, /Request sent\./);
  assert.match(textOf(asked.html), /You asked for: After dark, or any time it rains ?, on \(304\) 555-0199 ext 2 Waiting for Potomac Solutions/);
  assert.match(textOf(await admin.page("/")), /Call Dale Hinkle back Hinkle Family Farm\. Wants: After dark, or any time it rains\. On \(304\) 555-0199 ext 2\. Answer/);
  assert.match(await admin.page(`/clients/${clientId}`), /<a href="tel:\(304\) 555-0199 ext 2">/);
  assert.equal((await dale.submit("/portal/calls", { wanted: "Sunday" })).html.includes("Request sent."), true, "a number is optional");
});

test("a proposal says what it costs before anything else, and what happens after an answer", async () => {
  const html = await dale.page(`/portal/proposals/${proposalId}`);
  const page = textOf(html);
  assert.match(page, /What it costs Total \$2,400\.00 To start \$800\.00 Before launch \$1,600\.00 Go to your answer Download as a PDF/);
  assert.ok(html.indexOf("pprop-cost") < html.indexOf("pprop-estimate"), "the price comes before the detail");
  assert.match(page, /What happens next If you accept, Potomac Solutions sends an invoice for the \$800\.00 to start ?\. Work begins when it is paid/);
  assert.match(page, /If you decline, nothing is owed\./);
  await dale.submit(`/portal/proposals/${proposalId}/answer`, { decision: "accepted", typedName: "Dale Hinkle" });
  const after = await dale.page(`/portal/proposals/${proposalId}`);
  assert.doesNotMatch(after, /Go to your answer|What happens next/);
  assert.match(textOf(await dale.page("/portal")), /2 things are waiting on you/, "the answered proposal is no longer waiting");
});

test("asking for changes has room to say what, and when nothing is waiting the page says so", async () => {
  assert.match(await dale.page(`/portal/projects/${projectId}`), /<textarea id="changes-[0-9a-f-]{36}" name="note" rows="3" required/);
  await dale.submit(`/portal/deliverables/${deliverableId}/decision`, { decision: "approved", projectId });
  const invoice = t.services.finance.invoices.list()[0];
  assert.ok(invoice);
  unwrap(finance.recordPayment(t.services.finance, mikey, invoice.id, { amount: "800", method: "check", on: t.services.today(), reference: "1042" }));
  const home = textOf(await dale.page("/portal"));
  assert.match(home, /Nothing is waiting on you When Potomac Solutions needs a decision, an answer or a payment from you, it shows here first\./);
  assert.match(home, /Everything is paid\. Thank you\. INV-0001 · Farm stand website Paid, thank you\. \$800\.00/);
  assert.doesNotMatch(home, /How to pay/);
});

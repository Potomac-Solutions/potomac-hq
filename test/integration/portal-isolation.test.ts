// The client portal's isolation suite (roadmap v0.6). It signs in as client A
// and tries every portal route against client B's records, and every internal
// route with a client's session. It runs on every merge.
//
// The lists of routes are read from the source, so a route added later is
// tried here without anyone remembering to add it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import * as portal from "../../src/portal/index.ts";
import * as projects from "../../src/projects/index.ts";
import * as proposals from "../../src/proposals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, count, httpClient, PASSWORD, PDF, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
let ann: Client; // client A: Mt. Storm Bakery
let bob: Client; // client B: Gormania Feed

type World = { clientId: Id; projectId: Id; sharedDeliverable: Id; sharedFile: Id; draftDeliverable: Id; draftFile: Id; sharedProposal: Id; privateProposal: Id; sentInvoice: Id; draftInvoice: Id };
let a: World;
let b: World;

/** A client with a project, a shared and a draft deliverable, a shared and an unshared proposal, and a sent and a draft invoice. */
async function world(name: string, title: string): Promise<World> {
  const s = t.services;
  const { client, project } = await wonProject(s, mikey, { client: name, title });
  unwrap(projects.addMilestone(s.projects, mikey, project.id, { name: `${title} launch`, dueOn: "2099-01-01" }));
  const shared = unwrap(projects.addDeliverable(s.projects, mikey, project.id, { title: `${title} design`, file: { name: "design.pdf", bytes: PDF } }));
  unwrap(projects.setDeliverableShared(s.projects, mikey, shared.id, true));
  const draft = unwrap(projects.addDeliverable(s.projects, mikey, project.id, { title: `${title} secret draft`, file: { name: "draft.pdf", bytes: PDF } }));
  const proposal = (share: boolean, suffix: string) => {
    const opportunity = unwrap(crm.createOpportunity(s.crm, mikey, client.id, { title: `${title} ${suffix}`, leadSource: "phone", service: "application" }));
    for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(s.crm, mikey, opportunity.id, { to }));
    const made = unwrap(proposals.startProposal(s.proposals, mikey, opportunity.id, {}));
    unwrap(proposals.sendProposalVersion(s.proposals, mikey, made.id));
    if (share) unwrap(proposals.setProposalShared(s.proposals, mikey, made.id, true));
    return made.id;
  };
  const sent = unwrap(finance.createInvoice(s.finance, mikey, project.id, { kind: "deposit", description: `${title} deposit`, amount: "500" }));
  unwrap(finance.sendInvoiceNow(s.finance, mikey, sent.id));
  const draftInvoice = unwrap(finance.createInvoice(s.finance, mikey, project.id, { kind: "balance", description: `${title} unsent balance`, amount: "1000" }));
  unwrap(portal.postProjectUpdate(s.portal, mikey, project.id, `${title}: the design is ready for you.`));
  return { clientId: client.id, projectId: project.id, sharedDeliverable: shared.id, sharedFile: shared.fileId, draftDeliverable: draft.id, draftFile: draft.fileId, sharedProposal: proposal(true, "phase two"), privateProposal: proposal(false, "internal pricing"), sentInvoice: sent.id, draftInvoice: draftInvoice.id };
}

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  a = await world("Mt. Storm Bakery", "Bakery website");
  b = await world("Gormania Feed", "Feed store site");
  ann = await clientSignedIn(t, admin, a.clientId, "Ann Baker", "ann@bakery.example");
  bob = await clientSignedIn(t, admin, b.clientId, "Bob Miller", "bob@feed.example");
});
after(() => t.stop());

const B_WORDS = /Gormania|Feed store|bob@feed/;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";

test("client A sees their own records, and not one word of client B's", async () => {
  const home = await ann.page("/portal");
  assert.match(home, /<h1>Mt\. Storm Bakery<\/h1>/);
  assert.match(textOf(home), /Bakery website On track Next: Bakery website launch, Thu, Jan 1, 2099, in \d+ days 0 of 1 step done/);
  assert.match(home, /Bakery website phase two/);
  assert.match(home, /INV-0001/);
  assert.doesNotMatch(home, /internal pricing|unsent balance|INV-0002/, "an unshared proposal and a draft invoice are not shown");
  assert.doesNotMatch(home, B_WORDS);

  const project = await ann.page(`/portal/projects/${a.projectId}`);
  assert.match(project, /Bakery website design/);
  assert.match(project, /the design is ready for you/);
  assert.doesNotMatch(project, /secret draft/, "a draft deliverable is never mentioned");
  assert.doesNotMatch(project, B_WORDS);

  assert.equal((await ann.get(`/portal/files/${a.sharedFile}`)).status, 200);
  assert.equal((await ann.get(`/portal/invoices/${a.sentInvoice}/pdf`)).status, 200);
  assert.equal((await ann.get(`/portal/proposals/${a.sharedProposal}/pdf`)).status, 200);
  assert.match(await ann.page(`/portal/proposals/${a.sharedProposal}`), /Waiting for your answer/);
});

test("client A cannot read anything of client B's: every portal page and download answers 404", async () => {
  const theirs = [
    `/portal/projects/${b.projectId}`,
    `/portal/proposals/${b.sharedProposal}`,
    `/portal/proposals/${b.sharedProposal}/pdf`,
    `/portal/invoices/${b.sentInvoice}/pdf`,
    `/portal/files/${b.sharedFile}`,
  ];
  // Their own records that were never shared with them are just as absent.
  const unshared = [`/portal/files/${a.draftFile}`, `/portal/proposals/${a.privateProposal}`, `/portal/proposals/${a.privateProposal}/pdf`, `/portal/invoices/${a.draftInvoice}/pdf`];
  const nonsense = ["/portal/projects/not-an-id", "/portal/projects/00000000-0000-4000-8000-000000000000", "/portal/files/00000000-0000-4000-8000-000000000000"];
  for (const path of [...theirs, ...unshared, ...nonsense]) {
    const res = await ann.get(path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(await res.text(), B_WORDS, path);
  }
  // The same addresses work for the client they belong to, so the 404s above are isolation, not broken routes.
  for (const path of theirs) assert.equal((await bob.get(path)).status, 200, `${path} for its own client`);
});

test("client A cannot change anything of client B's: every portal form is refused and writes nothing", async () => {
  const before = { events: count(t.db, "activity_event"), updates: count(t.db, "project_update"), decisions: count(t.db, "proposal_decision") };
  const attempts: [string, Record<string, string>][] = [
    [`/portal/projects/${b.projectId}/messages`, { body: "Hello from the wrong client" }],
    [`/portal/deliverables/${b.sharedDeliverable}/decision`, { decision: "approved", projectId: b.projectId }],
    [`/portal/deliverables/${a.draftDeliverable}/decision`, { decision: "approved", projectId: a.projectId }],
    [`/portal/proposals/${b.sharedProposal}/answer`, { decision: "accepted", typedName: "Ann Baker" }],
    [`/portal/proposals/${a.privateProposal}/answer`, { decision: "accepted", typedName: "Ann Baker" }],
    ["/portal/messages", { projectId: b.projectId, body: "Hello from the home page of the wrong client" }],
  ];
  for (const [path, fields] of attempts) {
    const res = await ann.post(path, fields);
    assert.equal(res.status, 303, path);
    assert.equal(problemOf(res), "That record doesn’t exist.", path);
  }
  // A file sent to another client's project is refused, and nothing is stored.
  const files = count(t.db, "file");
  const sent = await ann.upload(`/portal/projects/${b.projectId}/files`, {}, { field: "file", name: "menu.pdf", bytes: PDF });
  assert.equal(sent.status, 303);
  assert.equal(problemOf(sent), "That record doesn’t exist.");
  assert.equal(count(t.db, "file"), files);
  assert.equal(count(t.db, "file_blob"), files);
  assert.deepEqual({ events: count(t.db, "activity_event"), updates: count(t.db, "project_update"), decisions: count(t.db, "proposal_decision") }, before);
  assert.equal(t.services.projects.deliverables.get(b.sharedDeliverable)?.status, "shared");
  assert.equal(t.services.proposals.proposals.get(b.sharedProposal)?.status, "sent");

  // The services themselves refuse it too, not just the routes.
  const session = portal.clientSession(t.services.portal, "") ?? { clientUserId: "11111111-1111-4111-8111-111111111111" as Id, organizationId: a.clientId, name: "Ann" };
  assert.deepEqual(portal.portalProject(t.services.portal, session, b.projectId), { ok: false, error: "not-found" });
  assert.deepEqual(portal.portalProposal(t.services.portal, session, b.sharedProposal), { ok: false, error: "not-found" });
  assert.deepEqual(portal.sendMessage(t.services.portal, session, b.projectId, "x"), { ok: false, error: "not-found" });
  assert.deepEqual(portal.decideOnDeliverable(t.services.portal, session, b.sharedDeliverable, { decision: "approved" }), { ok: false, error: "not-found" });
  assert.deepEqual(portal.answerProposal(t.services.portal, session, b.sharedProposal, { decision: "accepted", typedName: "Ann" }), { ok: false, error: "not-found" });
  assert.deepEqual(portal.portalInvoiceDocument(t.services.portal, session, b.sentInvoice), { ok: false, error: "not-found" });
  assert.deepEqual(portal.portalProposalDocument(t.services.portal, null, a.sharedProposal), { ok: false, error: "not-found" });
  assert.deepEqual(portal.sendFile(t.services.portal, session, b.projectId, { name: "menu.pdf", bytes: PDF }), { ok: false, error: "not-found" });
});

test("an organization named by the browser is ignored: the session decides", async () => {
  const asked = await ann.post("/portal/calls", { wanted: "Thursday afternoon", note: "Menu page", organizationId: b.clientId, clientUserId: "anything" });
  assert.equal(asked.status, 303);
  assert.equal(t.services.portal.calls.listFor(b.clientId).length, 0);
  assert.deepEqual(t.services.portal.calls.listFor(a.clientId).map((call) => [call.wanted, call.clientUserName]), [["Thursday afternoon", "Ann Baker"]]);
  const message = await ann.post(`/portal/projects/${a.projectId}/messages`, { body: "Can the logo be bigger?", projectId: b.projectId, organizationId: b.clientId });
  assert.match(message.headers.get("location") ?? "", new RegExp(`^/portal/projects/${a.projectId}\\?done=`));
  assert.equal(t.services.portal.updates.listFor(b.projectId).filter((u) => u.fromClient).length, 0);
});

test("a file a client sends is theirs alone: another client cannot download it, and HQ's own address refuses a client", async () => {
  const sent = await ann.upload(`/portal/projects/${a.projectId}/files`, {}, { field: "file", name: "bakery-prices.pdf", bytes: PDF });
  assert.match(sent.headers.get("location") ?? "", new RegExp(`^/portal/projects/${a.projectId}\\?done=`));
  const file = t.db.prepare("select id, organization_id, uploaded_by, uploaded_by_client from file where owner_type = 'client-upload'").get() as Record<string, string | null>;
  assert.equal(file["organization_id"], a.clientId);
  assert.equal(file["uploaded_by"], null);
  assert.ok(file["uploaded_by_client"]);
  assert.equal((await ann.get(`/portal/files/${file["id"]}`)).status, 200, "its own client can get it back");
  assert.equal((await bob.get(`/portal/files/${file["id"]}`)).status, 404);
  assert.equal((await ann.get(`/files/${file["id"]}`)).status, 404);
  assert.equal((await admin.get(`/files/${file["id"]}`)).status, 200, "Potomac can open it");
  assert.doesNotMatch(await bob.page(`/portal/projects/${b.projectId}`), /bakery-prices/);
  assert.doesNotMatch(await bob.page("/portal"), /Ann Baker|Mt\. Storm/, "who can sign in lists only their own people");
});

// Every page and every form in HQ that is not part of the portal, read from the source.
function sourceFiles(dir: string, ending: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(dir, entry.name), ending) : entry.name.endsWith(ending) ? [join(dir, entry.name)] : []));
}
const src = join(import.meta.dirname, "..", "..", "src");
const pagePatterns = sourceFiles(src, ".zb").flatMap((file) => [...readFileSync(file, "utf8").matchAll(/'use route ([^']+)'/g)].map((match) => match[1] as string));
const postPatterns = sourceFiles(src, ".ts")
  .filter((file) => /[\\/]api[\\/]/.test(file) && !file.endsWith(".test.ts"))
  .flatMap((file) => [...readFileSync(file, "utf8").matchAll(/\bpost\(\s*"(\/[^"]*)"/g)].map((match) => match[1] as string));
const fill = (pattern: string, id: string) => pattern.replace(/:n\b/, "1").replace(/:[a-z]+/g, id);

test("a client's session opens no internal page: each one answers 401 with the sign-in form and no records", async () => {
  // The one page anyone may open signed out: the form that asks for a password reset. It shows no records.
  const PUBLIC = ["/forgot-password"];
  const internal = pagePatterns.filter((pattern) => !pattern.startsWith("/portal") && !PUBLIC.includes(pattern));
  assert.ok(internal.length >= 19, `found ${internal.length} internal pages`);
  for (const path of PUBLIC) assert.doesNotMatch(await ann.page(path), /Gormania|Feed store|Bakery website|Mt\. Storm/, path);
  for (const pattern of internal) {
    for (const id of [b.projectId, a.projectId]) {
      const res = await ann.get(fill(pattern, id));
      const body = await res.text();
      assert.equal(res.status, 401, `${pattern} answered ${res.status}`);
      assert.match(body, /Sign in/, pattern);
      assert.doesNotMatch(body, /Gormania|Feed store|Bakery website|Mt\. Storm/, pattern);
    }
  }
  for (const path of [`/files/${a.sharedFile}`, `/files/${b.sharedFile}`, "/exports/time.csv", `/proposals/${a.sharedProposal}/versions/1/pdf`, `/invoices/${a.sentInvoice}/pdf`]) {
    assert.equal((await ann.get(path)).status, 404, path);
  }
});

test("a client's session can post to no internal form: each one is refused and writes nothing", async () => {
  const internal = [...new Set(postPatterns)].filter((pattern) => !pattern.startsWith("/portal/") && pattern !== "/forgot-password");
  assert.ok(internal.length >= 40, `found ${internal.length} internal forms`);
  const tables = ["activity_event", "client_organization", "opportunity", "project", "task", "note", "proposal", "time_entry", "expense", "invoice", "payment", "client_user", "project_update", "file"];
  const before = tables.map((table) => count(t.db, table));
  for (const pattern of internal) {
    const res = await ann.post(fill(pattern, b.projectId), { name: "x", title: "x", body: "x", to: "done", status: "cancelled", email: "x@example.com", theme: "dark", decision: "accepted", byName: "x", on: "2026-01-01", method: "cash", amount: "1", hours: "1", target: b.projectId, recordType: "project", recordId: b.projectId, ownerId: mikey, answer: "declined" });
    assert.equal(res.status, 303, `${pattern} answered ${res.status}`);
    assert.match(problemOf(res), /permission|Sign in again|doesn’t exist/, `${pattern}: ${res.headers.get("location")}`);
  }
  assert.deepEqual(tables.map((table) => count(t.db, table)), before, "nothing was written");
});

test("the two sign-ins are separate: a client's password opens nothing in HQ, and an HQ session is nobody in the portal", async () => {
  const stranger = httpClient(t.origin);
  const asStaff = await stranger.post("/staff/sign-in", { email: "ann@bakery.example", password: PASSWORD });
  assert.notEqual(asStaff.headers.get("location"), "/");
  assert.equal((await stranger.get("/clients")).status, 401);

  const page = await admin.get("/portal");
  assert.equal(page.status, 401, "HQ's own session is not a portal session");
  assert.doesNotMatch(await page.text(), /Mt\. Storm|Gormania/);
  assert.equal((await admin.get(`/portal/projects/${a.projectId}`)).status, 401);
  assert.equal((await admin.get(`/portal/files/${a.sharedFile}`)).status, 404);
  assert.equal(problemOf(await admin.post(`/portal/projects/${a.projectId}/messages`, { body: "x" })), "That record doesn’t exist.");
  const asClient = await stranger.post("/portal/sign-in", { email: "mikey@example.com", password: PASSWORD });
  assert.match(problemOf(asClient), /don’t match/);

  for (const path of ["/portal", `/portal/projects/${a.projectId}`, `/portal/proposals/${a.sharedProposal}`]) assert.equal((await stranger.get(path)).status, 401, path);
  for (const path of [`/portal/files/${a.sharedFile}`, `/portal/invoices/${a.sentInvoice}/pdf`, `/portal/proposals/${a.sharedProposal}/pdf`]) assert.equal((await stranger.get(path)).status, 404, path);
});

test("turning a client's access off ends their session at once, and their link stops working", async () => {
  const carol = await clientSignedIn(t, admin, a.clientId, "Carol Baker", "carol@bakery.example");
  assert.equal((await carol.get("/portal")).status, 200);
  const user = t.services.portal.clientUsers.byEmail("carol@bakery.example");
  assert.ok(user);
  const off = await admin.submit(`/portal-users/${user.id}/access`, { on: "0", organizationId: a.clientId });
  assert.match(off.html, /Access turned off\. They are signed out\./);
  assert.equal((await carol.get("/portal")).status, 401);
  assert.equal((await carol.get(`/portal/files/${a.sharedFile}`)).status, 404);
  assert.match(problemOf(await carol.post("/portal/sign-in", { email: "carol@bakery.example", password: PASSWORD })), /don’t match/);
  assert.match(problemOf(await admin.post(`/portal-users/${user.id}/link`, { organizationId: a.clientId })), /Their access is turned off/);
});

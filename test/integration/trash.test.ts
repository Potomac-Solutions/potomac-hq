// The Trash (decision 0023) on a real database: a client goes with
// everything that belongs to it and comes back exactly as it was; what only
// mentions it is kept with the link cleared; real money records are kept; and
// purging is for good.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import * as notes from "../../src/notes/index.ts";
import * as projects from "../../src/projects/index.ts";
import * as proposals from "../../src/proposals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import * as trash from "../../src/trash/index.ts";
import { clientSignedIn, PDF, signIn, TEST_PASSWORD_COST, testApp, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
const today = () => Temporal.Now.plainDateISO("America/New_York").toString();

// Every table's rows, to compare before a delete and after a restore. The activity log only grows, so it's left out.
function everything(): Record<string, string[]> {
  const tables = (t.db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not in ('activity_event', 'trash', 'kit_document', 'rate_limit', 'undo_stash', 'refused_attempt')").all() as { name: string }[]).map((r) => r.name);
  return Object.fromEntries(tables.map((name) => [name, (t.db.prepare(`select * from "${name}"`).all() as Record<string, unknown>[]).map((row) => JSON.stringify(row, (_, v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v))).sort()]));
}
const count = (sql: string, ...args: string[]) => Number(t.db.prepare(sql).get(...(args as never[]))?.["n"]);

/** A client with a deal, a sent proposal, a won project with tasks, a deliverable file, a sent invoice, a note and a portal person. */
async function busyClient(name: string, options: { paid?: boolean; demo?: boolean } = {}) {
  const s = t.services;
  const { client, project, opportunity: won } = await wonProject(s, mikey, { client: name, title: `${name} website` });
  const opportunity = unwrap(crm.createOpportunity(s.crm, mikey, client.id, { title: `${name} phase two`, leadSource: "phone", service: "application" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(s.crm, mikey, opportunity.id, { to }));
  unwrap(crm.addContact(s.crm, mikey, client.id, { name: `${name} Owner`, email: `owner@${name.toLowerCase().replace(/\W+/g, "")}.example`, isPrimary: true }));
  unwrap(projects.addMilestone(s.projects, mikey, project.id, { name: "Launch", dueOn: "2099-01-01" }));
  unwrap(projects.addDeliverable(s.projects, mikey, project.id, { title: "Design", file: { name: "design.pdf", bytes: PDF } }));
  const proposal = unwrap(proposals.startProposal(s.proposals, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(s.proposals, mikey, proposal.id));
  const invoice = unwrap(finance.createInvoice(s.finance, mikey, project.id, { kind: "deposit", description: "Deposit", amount: "500" }));
  unwrap(finance.sendInvoiceNow(s.finance, mikey, invoice.id));
  if (options.paid) unwrap(finance.recordPayment(s.finance, mikey, invoice.id, { amount: "100", method: "check", on: today(), reference: "1001" }));
  unwrap(notes.addNote(s.notes, mikey, { recordType: "client-organization", recordId: client.id, body: "Met at the fair." }));
  if (options.demo) unwrap(crm.setClientDemo(s.crm, mikey, client.id, true));
  return { client, project, won, opportunity, proposal, invoice };
}

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("a client goes with everything that belongs to it, and comes back exactly as it was", async () => {
  const kept = await busyClient("Gormania Feed");
  const gone = await busyClient("Test Bakery", { paid: true, demo: true });
  await clientSignedIn(t, admin, gone.client.id, "Tess Baker", "tess@bakery.example");
  // Another client's deal that this one referred: kept, with the link cleared.
  const referred = unwrap(crm.createOpportunity(t.services.crm, mikey, kept.client.id, { title: "Referred work", leadSource: "referral", service: "website", referredByOrg: gone.client.id } as never));
  t.db.prepare("update opportunity set referred_by_org = ? where id = ?").run(gone.client.id, referred.id);
  const before = everything();

  const preview = unwrap(trash.previewDelete(t.services.trash, mikey, "client", [gone.client.id]));
  assert.equal(preview.count, 1);
  assert.match(preview.items[0]?.takes ?? "", /1 project.*1 invoice.*1 payment/);

  const done = unwrap(trash.deleteRecords(t.services.trash, mikey, "client", [gone.client.id]));
  assert.equal(done.deleted, 1);
  assert.equal(count("select count(*) as n from client_organization where id = ?", gone.client.id), 0);
  assert.equal(count("select count(*) as n from project where organization_id = ?", gone.client.id), 0);
  assert.equal(count("select count(*) as n from proposal_version v join proposal p on p.id = v.proposal_id where p.opportunity_id = ?", gone.opportunity.id), 0);
  assert.equal(count("select count(*) as n from client_user where organization_id = ?", gone.client.id), 0);
  assert.equal(count("select count(*) as n from note where record_id = ?", gone.client.id), 0);
  assert.equal(count("select count(*) as n from file f join deliverable d on d.file_id = f.id where d.project_id = ?", gone.project.id), 0);
  assert.equal(t.db.prepare("select referred_by_org from opportunity where id = ?").get(referred.id)?.["referred_by_org"], null, "the other client's deal stays, without the link");
  assert.deepEqual(t.db.prepare("pragma foreign_key_check").all(), []);
  // The other client is untouched.
  assert.equal(count("select count(*) as n from project where organization_id = ?", kept.client.id), 1);
  assert.equal(count("select count(*) as n from invoice where organization_id = ?", kept.client.id), 1);

  const view = unwrap(trash.trashView(t.services.trash, mikey));
  assert.equal(view.items[0]?.label, "Test Bakery");
  assert.equal(view.items[0]?.daysLeft, 30);

  unwrap(trash.restoreFromTrash(t.services.trash, mikey, [done.trashIds[0] as string]));
  assert.deepEqual(everything(), before, "every row is back, and the cleared link with it");
  assert.deepEqual(t.db.prepare("pragma foreign_key_check").all(), []);
  assert.equal(unwrap(trash.trashView(t.services.trash, mikey)).items.length, 0);

  // Deleted again, then purged: gone for good.
  const again = unwrap(trash.deleteRecords(t.services.trash, mikey, "client", [gone.client.id]));
  assert.equal(unwrap(trash.purgeFromTrash(t.services.trash, mikey, again.trashIds)).purged, 1);
  assert.equal(count("select count(*) as n from trash"), 0);
  assert.equal(count("select count(*) as n from client_organization where id = ?", gone.client.id), 0);
  const actions = (t.db.prepare("select action from activity_event where record_id = ? and action like 'client-organization.%' order by rowid").all(gone.client.id) as { action: string }[]).map((r) => r.action);
  assert.deepEqual(actions.filter((a) => /trashed|restored|purged/.test(a)), ["client-organization.trashed", "client-organization.restored", "client-organization.trashed", "client-organization.purged"]);
});

test("a real client with money records is kept; one without is deleted", async () => {
  const paid = await busyClient("Real Paid Co", { paid: true });
  const unpaid = await busyClient("Real Unpaid Co");
  const preview = unwrap(trash.previewDelete(t.services.trash, mikey, "client", [paid.client.id, unpaid.client.id]));
  assert.equal(preview.count, 1);
  assert.match(preview.items.find((i) => i.id === paid.client.id)?.refused ?? "", /1 payment recorded/);
  const done = unwrap(trash.deleteRecords(t.services.trash, mikey, "client", [paid.client.id, unpaid.client.id]));
  assert.equal(done.deleted, 1);
  assert.equal(done.refused, 1);
  assert.match(done.message, /1 client moved to the Trash\. 1 client kept/);
  assert.equal(count("select count(*) as n from client_organization where id = ?", paid.client.id), 1);
  assert.deepEqual(trash.deleteRecords(t.services.trash, mikey, "client", [paid.client.id]), { ok: false, error: "has-money" });
});

test("a contact goes alone: deals and calls that named them stay, and the bill contact is cleared", async () => {
  const { client, opportunity } = await busyClient("Contact Test Co");
  const contact = unwrap(crm.addContact(t.services.crm, mikey, client.id, { name: "Dana Doe", email: "dana@example.com" }));
  t.db.prepare("update opportunity set contact_id = ? where id = ?").run(contact.id, opportunity.id);
  t.db.prepare("update client_organization set billing_contact_id = ? where id = ?").run(contact.id, client.id);
  const done = unwrap(trash.deleteRecords(t.services.trash, mikey, "contact", [contact.id]));
  assert.equal(count("select count(*) as n from contact where id = ?", contact.id), 0);
  assert.equal(count("select count(*) as n from opportunity where id = ? and contact_id is null", opportunity.id), 1);
  assert.equal(count("select count(*) as n from client_organization where id = ? and billing_contact_id is null", client.id), 1);
  unwrap(trash.restoreFromTrash(t.services.trash, mikey, done.trashIds));
  assert.equal(count("select count(*) as n from opportunity where id = ? and contact_id = ?", opportunity.id, contact.id), 1);
  assert.equal(count("select count(*) as n from client_organization where id = ? and billing_contact_id = ?", client.id, contact.id), 1);
});

test("a sent proposal can go; a signed one at a real client stays", async () => {
  const { proposal, opportunity } = await busyClient("Proposal Test Co");
  unwrap(trash.deleteRecords(t.services.trash, mikey, "proposal", [proposal.id]));
  assert.equal(count("select count(*) as n from proposal where id = ?", proposal.id), 0);
  assert.equal(count("select count(*) as n from opportunity where id = ?", opportunity.id), 1, "the deal stays");
  // A sent version still can't be deleted any other way.
  const other = await busyClient("Immutable Co");
  assert.throws(() => t.db.prepare("delete from proposal_version where proposal_id = ?").run(other.proposal.id), /immutable/);
  const signed = unwrap(proposals.startProposal(t.services.proposals, mikey, other.opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(t.services.proposals, mikey, signed.id));
  t.db.prepare("insert into agreement (id, proposal_id, version, reference, signed_on, recorded_by, created_at) values (?, ?, 1, 'Signed on paper', ?, ?, ?)").run(t.services.crm.newId(), signed.id, today(), mikey, new Date().toISOString());
  assert.deepEqual(trash.deleteRecords(t.services.trash, mikey, "proposal", [signed.id]), { ok: false, error: "has-money" });
});

test("a project goes with its tasks, invoices and files; the client and deal stay", async () => {
  const { client, project, won: opportunity } = await busyClient("Project Test Co");
  unwrap(trash.deleteRecords(t.services.trash, mikey, "project", [project.id]));
  assert.equal(count("select count(*) as n from project where id = ?", project.id), 0);
  assert.equal(count("select count(*) as n from invoice where project_id = ?", project.id), 0);
  assert.equal(count("select count(*) as n from client_organization where id = ?", client.id), 1);
  assert.equal(count("select count(*) as n from opportunity where id = ?", opportunity.id), 1);
  assert.deepEqual(t.db.prepare("pragma foreign_key_check").all(), []);
});

test("only admins delete, restore or purge", async () => {
  const { client } = await busyClient("Members Co");
  await signIn(t, "sam@example.com", "Sam Helper", ["manager"]);
  const sam = t.db.prepare("select id from user where email = 'sam@example.com'").get()?.["id"] as Id;
  assert.deepEqual(trash.deleteRecords(t.services.trash, sam, "client", [client.id]), { ok: false, error: "forbidden" });
  assert.deepEqual(trash.previewDelete(t.services.trash, sam, "client", [client.id]), { ok: false, error: "forbidden" });
  assert.deepEqual(trash.trashView(t.services.trash, sam), { ok: false, error: "forbidden" });
  assert.deepEqual(trash.purgeFromTrash(t.services.trash, sam, "all"), { ok: false, error: "forbidden" });
});

test("after 30 days the nightly run purges", async () => {
  const { client } = await busyClient("Old Test Co", { demo: true });
  const done = unwrap(trash.deleteRecords(t.services.trash, mikey, "client", [client.id]));
  assert.equal(trash.purgeExpiredTrash(t.services.trash), 0, "not yet");
  t.db.prepare("update trash set deleted_at = ? where id = ?").run(Temporal.Now.instant().subtract({ hours: 24 * 31 }).toString(), done.trashIds[0] as string);
  assert.equal(trash.purgeExpiredTrash(t.services.trash), 1);
  assert.equal(count("select count(*) as n from trash where id = ?", done.trashIds[0] as string), 0);
});

test("someone from a deleted client can be invited again with the same email", async () => {
  const { client } = await busyClient("Reinvite Test Co", { demo: true });
  await clientSignedIn(t, admin, client.id, "Rae Invite", "rae@example.com");
  const done = unwrap(trash.deleteRecords(t.services.trash, mikey, "client", [client.id]));
  unwrap(trash.purgeFromTrash(t.services.trash, mikey, done.trashIds));
  const next = await wonProject(t.services, mikey, { client: "Reinvite Real Co", title: "Real website" });
  const rae = await clientSignedIn(t, admin, next.client.id, "Rae Invite", "rae@example.com");
  assert.match(await rae.page("/portal"), /<h1>Reinvite Real Co<\/h1>/);
});

test("over HTTP: the page that asks first, the delete with Undo, the Trash page and putting back", async () => {
  const one = await busyClient("Web Demo One", { demo: true });
  const two = await busyClient("Web Demo Two", { demo: true });
  const real = await busyClient("Web Real Paid", { paid: true });

  // A record's page offers Delete; the list offers ticks and "Delete all demo clients".
  assert.match(await admin.page(`/clients/${one.client.id}`), /href="\/delete\?kind=client&(amp;)?ids=[0-9a-f-]{36}&(amp;)?back=\/clients"/);
  const list = await admin.page("/clients");
  assert.match(list, /aria-label="Pick Web Demo One"/);
  assert.match(list, /Delete all demo clients/);

  const ask = await admin.page(`/delete?kind=client&ids=${one.client.id}&ids=${real.client.id}&back=/clients`);
  assert.match(ask, /Delete this client\?/);
  assert.match(ask, /Web Demo One/);
  assert.match(ask, /Kept:.*1 payment recorded/s);
  assert.match(ask, new RegExp(`name="ids" value="${one.client.id}"`));

  const demos = await admin.page("/delete?kind=client&demo=all&back=/clients");
  assert.match(demos, /Web Demo Two/);
  assert.doesNotMatch(demos, /Web Real Paid/);

  const deleted = await admin.post("/delete", { kind: "client", ids: `${one.client.id},${two.client.id}`, back: "/clients" });
  assert.equal(deleted.status, 303);
  const location = new URL(t.origin + (deleted.headers.get("location") ?? ""));
  assert.equal(location.pathname, "/clients");
  assert.match(location.searchParams.get("done") ?? "", /2 clients moved to the Trash/);
  assert.ok(location.searchParams.get("undo"), "offers Undo");

  const page = await admin.page("/trash");
  assert.match(page, /Web Demo One/);
  assert.match(page, /30 days left/);
  const trashId = t.db.prepare("select id from trash where record_id = ?").get(one.client.id)?.["id"] as string;
  const back = await admin.submit("/trash/restore", { ids: trashId });
  assert.match(back.html, /Web Demo One is back\./);
  assert.equal(count("select count(*) as n from client_organization where id = ?", one.client.id), 1);
  const gone = await admin.submit("/trash/empty", {});
  assert.match(gone.html, /The Trash is empty/);

  // Elsewhere than HQ's own pages, a delete goes back to the Trash.
  const sneaky = await admin.post("/delete", { kind: "contact", ids: "00000000-0000-4000-8000-000000000000", back: "https://evil.example" });
  assert.doesNotMatch(sneaky.headers.get("location") ?? "", /evil/);
});

test("over HTTP: someone who isn't an admin sees no Delete and can't open the Trash", async () => {
  const { client } = await busyClient("Member View Co");
  const member = await signIn(t, "mel@example.com", "Mel Member", ["member"]);
  assert.doesNotMatch(await member.page(`/clients/${client.id}`), /Delete client/);
  assert.equal((await member.get("/trash")).status, 403);
  assert.equal((await member.get(`/delete?kind=client&ids=${client.id}`)).status, 403);
  const refused = await member.post("/delete", { kind: "client", ids: client.id, back: "/clients" });
  assert.match(new URL(t.origin + (refused.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /Only an admin/);
  assert.equal(count("select count(*) as n from client_organization where id = ?", client.id), 1);
});

// The first slice's services against a real database built from the repo's
// migrations: prospect, contact, opportunity, follow-up, project.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import * as crm from "../application/commands.ts";
import { clientDetail, followUpsDue, listClients, opportunityDetail, pipeline } from "../application/queries.ts";
import { sqliteUserStore } from "../../identity/adapters.ts";
import type { RoleKey } from "../../identity/index.ts";
import { sqliteProjectStore } from "../../projects/adapters.ts";
import { migrate, newId, openDatabase, readMigrations, sqliteActivityLog, sqliteTransact, systemClock, type Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";
import { sqliteClientStore, sqliteContactStore, sqliteOpportunityStore } from "./stores.ts";

const migrationsDir = join(import.meta.dirname, "..", "..", "..", "migrations");
let dir: string;
let db: Database;
let deps: crm.CrmDeps;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hq-crm-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db, readMigrations(migrationsDir), systemClock);
  deps = {
    users: sqliteUserStore(db),
    activityLog: sqliteActivityLog(db),
    transact: sqliteTransact(db),
    clock: systemClock,
    newId,
    clients: sqliteClientStore(db),
    contacts: sqliteContactStore(db),
    opportunities: sqliteOpportunityStore(db),
    projects: sqliteProjectStore(db),
  };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function user(role: RoleKey | null, name = `User ${role}`): Id {
  const id = newId();
  db.prepare("insert into user (id, staff_account, name, email, status, created_at, updated_at) values (?, ?, ?, ?, 'active', 'now', 'now')").run(id, `acct-${id}`, name, `${id}@example.com`);
  if (role) db.prepare("insert into user_role (user_id, role_id) select ?, id from role where key = ?").run(id, role);
  return id;
}

function events(): { actor: string | null; action: string; type: string; context: Record<string, unknown> }[] {
  return (db.prepare("select actor_id, action, record_type, context from activity_event order by rowid").all() as Record<string, string>[]).map((r) => ({
    actor: r["actor_id"] ?? null,
    action: r["action"] as string,
    type: r["record_type"] as string,
    context: JSON.parse(r["context"] as string),
  }));
}

function count(table: string): number {
  return db.prepare(`select count(*) as n from ${table}`).get()?.["n"] as number;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) assert.fail(`refused: ${result.error}`);
  return result.value;
}

test("the slice end to end: prospect, contact, opportunity, follow-up, won, project", () => {
  const mikey = user("admin", "Mikey Nichols");

  const client = unwrap(crm.createClient(deps, mikey, { name: "Mt. Storm Bakery", sizeTier: "small" }));
  assert.equal(client.status, "prospective");
  const contact = unwrap(crm.addContact(deps, mikey, client.id, { name: "Ann Baker", email: "ann@example.com", isPrimary: true }));
  const opportunity = unwrap(crm.createOpportunity(deps, mikey, client.id, { title: "Bakery website", leadSource: "word-of-mouth", service: "website", contactId: contact.id }));
  unwrap(crm.setOpportunityFollowUp(deps, mikey, opportunity.id, "2026-11-20"));

  assert.deepEqual(unwrap(followUpsDue(deps, mikey, "2026-11-19")).items, []);
  assert.deepEqual(unwrap(followUpsDue(deps, mikey, "2026-11-20")).items, [
    { id: opportunity.id, title: "Bakery website", clientName: "Mt. Storm Bakery", followUpOn: "2026-11-20", overdue: false },
  ]);

  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(deps, mikey, opportunity.id, { to }));
  unwrap(crm.setOpportunityValue(deps, mikey, opportunity.id, { pricing: "monthly", amount: "50" }));
  unwrap(crm.moveOpportunity(deps, mikey, opportunity.id, { to: "quoted" }));
  unwrap(crm.moveOpportunity(deps, mikey, opportunity.id, { to: "won" }));

  assert.equal(deps.clients.get(client.id)?.status, "active", "a win makes the client active");
  assert.deepEqual(unwrap(followUpsDue(deps, mikey, "2026-12-01")).items, [], "a won deal's follow-up is no longer due");

  const project = unwrap(crm.convertOpportunity(deps, mikey, opportunity.id));
  assert.equal(project.kind, "ongoing", "a monthly plan is ongoing");
  assert.equal(project.name, "Bakery website");
  assert.deepEqual(crm.convertOpportunity(deps, mikey, opportunity.id), { ok: false, error: "already-converted" });

  const stored = deps.projects.get(project.id);
  assert.deepEqual({ client: stored?.organizationId, opportunity: stored?.opportunityId, status: stored?.status, health: stored?.health }, { client: client.id, opportunity: opportunity.id, status: "active", health: "on-track" });

  assert.deepEqual(
    events().map((e) => `${e.action} ${e.type}`),
    [
      "client.created client-organization",
      "contact.created contact",
      "opportunity.created opportunity",
      "opportunity.follow-up-set opportunity",
      "opportunity.stage-changed opportunity",
      "opportunity.stage-changed opportunity",
      "opportunity.value-set opportunity",
      "opportunity.stage-changed opportunity",
      "opportunity.stage-changed opportunity",
      "client.status-changed client-organization",
      "opportunity.converted opportunity",
      "project.created project",
    ],
  );
  assert.ok(events().every((e) => e.actor === mikey), "every event names who did it");
  assert.deepEqual(events()[9]?.context, { from: "prospective", to: "active", because: "opportunity-won", opportunityId: opportunity.id });
});

test("someone with no roles is refused every change, and nothing is written", () => {
  const admin = user("admin");
  const client = unwrap(crm.createClient(deps, admin, { name: "A" }));
  const opportunity = unwrap(crm.createOpportunity(deps, admin, client.id, { title: "A job", leadSource: "phone" }));
  const before = events().length;

  for (const actor of [user(null), newId(), null]) {
    assert.deepEqual(crm.createClient(deps, actor, { name: "B" }), { ok: false, error: "forbidden" });
    assert.deepEqual(crm.setClientStatus(deps, actor, client.id, "former"), { ok: false, error: "forbidden" });
    assert.deepEqual(crm.addContact(deps, actor, client.id, { name: "C", phone: "304-555-0100" }), { ok: false, error: "forbidden" });
    assert.deepEqual(crm.createOpportunity(deps, actor, client.id, { title: "D", leadSource: "phone" }), { ok: false, error: "forbidden" });
    assert.deepEqual(crm.setOpportunityValue(deps, actor, opportunity.id, { pricing: "fixed", amount: "100" }), { ok: false, error: "forbidden" });
    assert.deepEqual(crm.moveOpportunity(deps, actor, opportunity.id, { to: "consult-booked" }), { ok: false, error: "forbidden" });
    assert.deepEqual(crm.setOpportunityFollowUp(deps, actor, opportunity.id, "2026-12-01"), { ok: false, error: "forbidden" });
    assert.deepEqual(crm.convertOpportunity(deps, actor, opportunity.id), { ok: false, error: "forbidden" });
    for (const read of [listClients(deps, actor), clientDetail(deps, actor, client.id), opportunityDetail(deps, actor, opportunity.id, "2026-11-15"), followUpsDue(deps, actor, "2026-11-15")]) {
      assert.deepEqual(read, { ok: false, error: "forbidden" });
    }
  }
  assert.equal(events().length, before);
  assert.equal(count("client_organization"), 1);
});

test("a member works deals but never sees or sets a price; a manager can", () => {
  const admin = user("admin");
  const member = user("member", "New Hire");
  const manager = user("manager", "A Manager");
  const client = unwrap(crm.createClient(deps, member, { name: "Gormania Feed & Seed" }));
  const opportunity = unwrap(crm.createOpportunity(deps, member, client.id, { title: "Store website", leadSource: "phone", service: "website" }));
  unwrap(crm.moveOpportunity(deps, member, opportunity.id, { to: "consult-booked" }));
  unwrap(crm.moveOpportunity(deps, member, opportunity.id, { to: "consulted" }));

  assert.deepEqual(crm.setOpportunityValue(deps, member, opportunity.id, { pricing: "monthly", amount: "50" }), { ok: false, error: "forbidden" });
  assert.deepEqual(crm.moveOpportunity(deps, member, opportunity.id, { to: "quoted" }), { ok: false, error: "price-required" }, "a member waits for the price");

  unwrap(crm.setOpportunityValue(deps, manager, opportunity.id, { pricing: "monthly", amount: "50" }));
  unwrap(crm.moveOpportunity(deps, member, opportunity.id, { to: "quoted" }));

  const memberView = unwrap(opportunityDetail(deps, member, opportunity.id, "2026-11-15"));
  assert.equal(memberView.opportunity.price, "");
  assert.equal(memberView.opportunity.amount, "");
  assert.equal(memberView.opportunity.pricing, "");
  assert.equal(memberView.can.setValue, false);
  assert.ok(!JSON.stringify(memberView).includes("5000"), "the amount is nowhere in what a member is given");
  assert.ok(!JSON.stringify(unwrap(clientDetail(deps, member, client.id))).includes("$50"));

  for (const viewer of [manager, admin]) {
    const view = unwrap(opportunityDetail(deps, viewer, opportunity.id, "2026-11-15"));
    assert.equal(view.opportunity.price, "$50.00 a month");
    assert.equal(view.opportunity.amount, "50.00");
    assert.equal(unwrap(clientDetail(deps, viewer, client.id)).opportunities[0]?.price, "$50.00 a month");
  }
});

test("a contact must belong to the opportunity's client, and only one contact is primary", () => {
  const admin = user("admin");
  const a = unwrap(crm.createClient(deps, admin, { name: "A" }));
  const b = unwrap(crm.createClient(deps, admin, { name: "B" }));
  const atB = unwrap(crm.addContact(deps, admin, b.id, { name: "Bea", phone: "304-555-0101" }));
  assert.deepEqual(crm.createOpportunity(deps, admin, a.id, { title: "x", leadSource: "phone", contactId: atB.id }), { ok: false, error: "contact-not-at-client" });

  unwrap(crm.addContact(deps, admin, a.id, { name: "Ann", phone: "304-555-0102", isPrimary: true }));
  unwrap(crm.addContact(deps, admin, a.id, { name: "Al", phone: "304-555-0103", isPrimary: true }));
  const contacts = unwrap(clientDetail(deps, admin, a.id)).contacts;
  assert.deepEqual(contacts.map((c) => [c.name, c.isPrimary]), [["Al", true], ["Ann", false]]);
});

test("unknown records are not found, and invalid input writes nothing", () => {
  const admin = user("admin");
  const before = events().length;
  assert.deepEqual(crm.addContact(deps, admin, newId(), { name: "x", phone: "304-555-0100" }), { ok: false, error: "not-found" });
  assert.deepEqual(crm.moveOpportunity(deps, admin, newId(), { to: "lost", lostReason: "x" }), { ok: false, error: "not-found" });
  assert.deepEqual(clientDetail(deps, admin, newId()), { ok: false, error: "not-found" });
  assert.deepEqual(crm.createClient(deps, admin, { name: "" }), { ok: false, error: "name-missing" });
  assert.deepEqual(crm.setOpportunityValue(deps, admin, newId(), { pricing: "hourly", amount: "lots" }), { ok: false, error: "not-an-amount" });
  assert.equal(events().length, before);
});

test("a lost deal keeps its reason and cannot be converted", () => {
  const admin = user("admin");
  const client = unwrap(crm.createClient(deps, admin, { name: "A" }));
  const opportunity = unwrap(crm.createOpportunity(deps, admin, client.id, { title: "x", leadSource: "phone" }));
  assert.deepEqual(crm.moveOpportunity(deps, admin, opportunity.id, { to: "lost" }), { ok: false, error: "lost-reason-required" });
  unwrap(crm.moveOpportunity(deps, admin, opportunity.id, { to: "lost", lostReason: "Too early for them" }));
  assert.deepEqual(crm.convertOpportunity(deps, admin, opportunity.id), { ok: false, error: "not-won" });
  assert.equal(deps.clients.get(client.id)?.status, "prospective", "losing does not change the client");
  assert.equal(unwrap(opportunityDetail(deps, admin, opportunity.id, "2026-11-15")).opportunity.lostReason, "Too early for them");
});

test("the free landing page goes from consulted straight to won and becomes a fixed project", () => {
  const admin = user("admin");
  const client = unwrap(crm.createClient(deps, admin, { name: "A" }));
  const opportunity = unwrap(crm.createOpportunity(deps, admin, client.id, { title: "Landing page", leadSource: "website", service: "landing-page" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(deps, admin, opportunity.id, { to }));
  unwrap(crm.setOpportunityValue(deps, admin, opportunity.id, { pricing: "free", amount: "" }));
  unwrap(crm.moveOpportunity(deps, admin, opportunity.id, { to: "won" }));
  assert.equal(unwrap(crm.convertOpportunity(deps, admin, opportunity.id)).kind, "fixed");
});

test("the database itself refuses what the rules refuse", () => {
  const admin = user("admin");
  const client = unwrap(crm.createClient(deps, admin, { name: "A" }));
  const opportunity = unwrap(crm.createOpportunity(deps, admin, client.id, { title: "x", leadSource: "phone" }));
  const raw = (sql: string, ...args: (string | number | null)[]) => () => db.prepare(sql).run(...args);
  assert.throws(raw("update opportunity set stage = 'won', closed_at = 'now' where id = ?", opportunity.id), /CHECK/i, "won needs service and price");
  assert.throws(raw("update opportunity set stage = 'lost', closed_at = 'now' where id = ?", opportunity.id), /CHECK/i, "lost needs a reason");
  assert.throws(raw("update opportunity set pricing = 'free', value_minor = 100 where id = ?", opportunity.id), /CHECK/i);
  assert.throws(raw("update opportunity set follow_up_on = 'tuesday' where id = ?", opportunity.id), /CHECK/i);
  assert.throws(raw("insert into contact (id, organization_id, name, created_at, updated_at) values (?, ?, 'x', 'now', 'now')", newId(), client.id), /CHECK/i, "email or phone");
  assert.throws(raw("insert into contact (id, organization_id, name, phone, created_at, updated_at) values (?, ?, 'x', '1', 'now', 'now')", newId(), newId()), /FOREIGN KEY/i);
});

test("the pipeline groups open opportunities by stage, and leaves prices out for a member", () => {
  const admin = user("admin");
  const member = user("member");
  const a = unwrap(crm.createClient(deps, admin, { name: "A" }));
  const b = unwrap(crm.createClient(deps, admin, { name: "B" }));
  const first = unwrap(crm.createOpportunity(deps, admin, a.id, { title: "First", leadSource: "phone", service: "website" }));
  const second = unwrap(crm.createOpportunity(deps, admin, b.id, { title: "Second", leadSource: "phone", service: "website" }));
  const lost = unwrap(crm.createOpportunity(deps, admin, b.id, { title: "Lost one", leadSource: "phone" }));
  unwrap(crm.moveOpportunity(deps, admin, lost.id, { to: "lost", lostReason: "No budget" }));
  unwrap(crm.moveOpportunity(deps, admin, second.id, { to: "consult-booked" }));
  unwrap(crm.setOpportunityValue(deps, admin, first.id, { pricing: "fixed", amount: "1,500" }));
  unwrap(crm.setOpportunityFollowUp(deps, admin, first.id, "2026-11-10"));

  const view = unwrap(pipeline(deps, admin, "2026-11-15"));
  assert.equal(view.openCount, 2);
  assert.deepEqual(view.columns.map((c) => [c.stage, c.nextStage, c.items.map((i) => i.title)]), [
    ["new", "consult-booked", ["First"]],
    ["consult-booked", "consulted", ["Second"]],
    ["consulted", "quoted", []],
    ["quoted", "won", []],
  ]);
  const card = view.columns[0]?.items[0];
  assert.equal(card?.price, "$1,500.00 fixed price");
  assert.equal(card?.followUpDue, true);
  assert.equal(card?.clientName, "A");

  const memberView = unwrap(pipeline(deps, member, "2026-11-15"));
  assert.equal(memberView.columns[0]?.items[0]?.price, "");
  assert.ok(!JSON.stringify(memberView).includes("1,500"));
  assert.deepEqual(pipeline(deps, user(null), "2026-11-15"), { ok: false, error: "forbidden" });
});

test("the clients list filters by status, and ignores a status that does not exist", () => {
  const admin = user("admin");
  const a = unwrap(crm.createClient(deps, admin, { name: "Prospect" }));
  const b = unwrap(crm.createClient(deps, admin, { name: "Former" }));
  unwrap(crm.setClientStatus(deps, admin, b.id, "former"));
  assert.deepEqual(unwrap(listClients(deps, admin, { status: "former" })).clients.map((c) => c.name), ["Former"]);
  assert.deepEqual(unwrap(listClients(deps, admin, { status: "prospective" })).clients.map((c) => c.id), [a.id]);
  const all = unwrap(listClients(deps, admin, { status: "deleted" }));
  assert.equal(all.status, "");
  assert.equal(all.clients.length, 2);
});

// Refused attempts over real HTTP (security review, gap 4): wrong
// passwords at either sign-in, wrong two-factor codes and forbidden forms
// are written down, shown to admins, and kept 90 days.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { codeAt, stepOf } from "../../src/identity/adapters.ts";
import { applyRetention, sqliteActivityLog, sqliteTransact } from "../../src/shared/adapters.ts";
import type { Id } from "../../src/shared/index.ts";
import { count, httpClient, PASSWORD, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
const rows = () => t.db.prepare("select kind, user_id, email, address, detail from refused_attempt order by occurred_at").all() as { kind: string; user_id: string | null; email: string | null; address: string; detail: string }[];
const userId = (email: string) => t.db.prepare("select id from user where email = ?").get(email)?.["id"] as Id;

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  await member.get("/");
});
after(() => t.stop());

test("a wrong password is written down with the email, never the password", async () => {
  const b = httpClient(t.origin);
  await b.post("/staff/sign-in", { email: "Mikey@Example.com", password: "not the password at all" });
  await b.post("/staff/sign-in", { email: "nobody@example.com", password: "guessing guessing" });
  const [first, second] = rows();
  assert.deepEqual({ ...first }, { kind: "sign-in", user_id: null, email: "mikey@example.com", address: first?.address, detail: "refused" });
  assert.equal(second?.email, "nobody@example.com");
  assert.ok(first?.address, "where it came from");
  assert.ok(!JSON.stringify(rows()).includes("not the password"), "no password");
  // A right password writes nothing here.
  await httpClient(t.origin).post("/staff/sign-in", { email: "mikey@example.com", password: PASSWORD });
  assert.equal(rows().length, 2);
});

test("a form someone is not allowed to use is written down, with the form", async () => {
  const before = rows().length;
  // A hand-written handler and one made by the shared form helper.
  await member.post("/people", { name: "X", email: "x@example.com", "role-admin": "1" });
  await member.post(`/people/${userId("mikey@example.com")}/roles`, { "role-member": "1" });
  const [one, two] = rows().slice(-2);
  assert.equal(rows().length, before + 2);
  assert.deepEqual([one?.kind, one?.user_id, one?.detail], ["permission", userId("sam@example.com"), "POST /people"]);
  assert.equal(two?.detail, "POST /people/:id/roles", "ids are left out");
  // Nobody signed in is not a refusal of a person: it is not written down.
  await httpClient(t.origin).post("/clients", { name: "Anon Co" });
  assert.equal(rows().length, before + 2);
});

test("a wrong two-factor code is written down against the person", async () => {
  await admin.post("/settings/two-factor", {});
  const id = userId("mikey@example.com");
  const secret = String(t.db.prepare("select secret from user_two_factor where user_id = ?").get(id)?.["secret"]);
  assert.equal((await admin.post("/settings/two-factor/confirm", { code: codeAt(secret, stepOf(Date.now())) })).status, 200);
  const b = httpClient(t.origin);
  await b.post("/staff/sign-in", { email: "mikey@example.com", password: PASSWORD });
  const wrong = codeAt(secret, stepOf(Date.now())) === "000000" ? "111111" : "000000";
  await b.post("/two-factor", { code: wrong });
  const last = rows().at(-1);
  assert.deepEqual([last?.kind, last?.user_id, last?.detail], ["second-step", id, "code-wrong"]);
  assert.ok(!JSON.stringify(rows()).includes(wrong), "not the code typed");
});

test("admins see them on their own page; others may not", async () => {
  const page = textOf(await admin.page("/activity/refused"));
  assert.match(page, /Refused attempts/);
  assert.match(page, /HQ sign-in · mikey@example\.com/);
  assert.match(page, /Password refused: wrong, no such account, or locked · from /);
  assert.match(page, /Not allowed · Sam Helper/);
  assert.match(page, /POST \/people\/:id\/roles/);
  assert.match(page, /Two-factor code · Mikey Nichols/);
  assert.match(page, /Wrong code/);
  assert.match(textOf(await admin.page("/activity")), /are under Refused attempts/);
  assert.equal((await member.get("/activity/refused")).status, 403);
});

test("they are kept 90 days, and left out of the export", async () => {
  const old = "2026-01-01T00:00:00Z";
  t.db.prepare("insert into refused_attempt (id, occurred_at, kind, user_id, email, address, detail) values ('00000000-0000-4000-8000-000000000001', ?, 'sign-in', null, 'old@example.com', '1.2.3.4', 'refused')").run(old);
  const before = count(t.db, "refused_attempt");
  applyRetention({ db: t.db, activityLog: sqliteActivityLog(t.db), transact: sqliteTransact(t.db), clock: () => new Date().toISOString(), newId: () => crypto.randomUUID() as Id });
  assert.equal(count(t.db, "refused_attempt"), before - 1);
});

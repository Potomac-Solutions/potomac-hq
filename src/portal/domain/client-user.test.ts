import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { activate, answerCall, newCallRequest, newClientUser, newUpdate, sessionFor, setAccess } from "./client-user.ts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as Id;
const ids = { id: id(1), organizationId: id(2), invitedBy: id(3) };

function invited() {
  const made = newClientUser(ids, { name: " Ann Baker ", email: "Ann@Example.com" });
  assert.ok(made.ok);
  return made.value;
}

test("an invited client belongs to one organization and has no session yet", () => {
  const user = invited();
  assert.deepEqual(user, { ...ids, portalAccount: null, name: "Ann Baker", email: "ann@example.com", status: "invited" });
  assert.equal(sessionFor(user), null);
  assert.equal(sessionFor(null), null);
  assert.deepEqual(newClientUser(ids, { name: "", email: "a@b.co" }), { ok: false, error: "name-missing" });
  assert.deepEqual(newClientUser(ids, { name: "Ann", email: "not-an-email" }), { ok: false, error: "invalid-email" });
  assert.deepEqual(newClientUser(ids, { name: "Ann", email: "" }), { ok: false, error: "invalid-email" });
});

test("accepting makes the session; the session's organization is the stored one", () => {
  const active = activate(invited(), "a1", "Ann B.");
  assert.ok(active.ok);
  assert.deepEqual(sessionFor(active.value), { clientUserId: id(1), organizationId: id(2), name: "Ann B." });
  assert.deepEqual(activate(active.value, "a2", "x"), { ok: false, error: "not-invited" });
});

test("access can be turned off and back on", () => {
  const active = activate(invited(), "a1", "");
  assert.ok(active.ok);
  const off = setAccess(active.value, false);
  assert.ok(off.ok);
  assert.equal(sessionFor(off.value), null, "a disabled client has no session");
  assert.deepEqual(setAccess(off.value, false), { ok: false, error: "unchanged" });
  const on = setAccess(off.value, true);
  assert.ok(on.ok);
  assert.equal(on.value.status, "active");
  const never = setAccess(invited(), false);
  assert.ok(never.ok);
  const back = setAccess(never.value, true);
  assert.ok(back.ok);
  assert.equal(back.value.status, "invited", "someone who never accepted goes back to invited");
});

test("an update has words, from Potomac or from the client", () => {
  const made = newUpdate({ id: id(5), projectId: id(6), userId: id(3), clientUserId: null }, "  Design is ready for you.  ", "t");
  assert.deepEqual(made, { ok: true, value: { id: id(5), projectId: id(6), userId: id(3), clientUserId: null, body: "Design is ready for you.", createdAt: "t" } });
  assert.deepEqual(newUpdate({ id: id(5), projectId: id(6), userId: null, clientUserId: id(1) }, " ", "t"), { ok: false, error: "message-empty" });
});

test("a call is asked for, then confirmed with a time or declined", () => {
  const asked = newCallRequest({ id: id(7), organizationId: id(2), clientUserId: id(1) }, { wanted: "Thursday afternoon", note: "About the menu page" });
  assert.ok(asked.ok);
  assert.equal(asked.value.status, "requested");
  assert.deepEqual(newCallRequest({ id: id(7), organizationId: id(2), clientUserId: id(1) }, { wanted: " " }), { ok: false, error: "wanted-missing" });
  assert.deepEqual(answerCall(asked.value, { answer: "confirmed" }, id(3)), { ok: false, error: "when-missing" });
  assert.deepEqual(answerCall(asked.value, { answer: "later" }, id(3)), { ok: false, error: "invalid-answer" });
  const confirmed = answerCall(asked.value, { answer: "confirmed", confirmedFor: "Thursday Nov 19, 2:00 PM", reply: "Talk then." }, id(3));
  assert.ok(confirmed.ok);
  assert.deepEqual([confirmed.value.status, confirmed.value.confirmedFor, confirmed.value.answeredBy], ["confirmed", "Thursday Nov 19, 2:00 PM", id(3)]);
  assert.deepEqual(answerCall(confirmed.value, { answer: "declined" }, id(3)), { ok: false, error: "already-answered" });
  const declined = answerCall(asked.value, { answer: "declined", confirmedFor: "ignored", reply: "Out that week." }, id(3));
  assert.ok(declined.ok);
  assert.equal(declined.value.confirmedFor, null);
});

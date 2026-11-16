import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { mayStopBeingAdmin, newInvite, newUser } from "./user.ts";

const id = "11111111-1111-4111-8111-111111111111" as Id;
const base = { id, staffAccount: "acct-1", name: "Mikey Nichols", email: "mikey@example.com" };

test("a new user is active, trimmed, with a lower-case email", () => {
  assert.deepEqual(newUser({ ...base, name: "  Mikey Nichols ", email: " Mikey@Example.COM " }), {
    ok: true,
    value: { id, staffAccount: "acct-1", name: "Mikey Nichols", email: "mikey@example.com", status: "active" },
  });
});

test("a name is required", () => {
  assert.deepEqual(newUser({ ...base, name: "   " }), { ok: false, error: "invalid-name" });
  assert.deepEqual(newUser({ ...base, name: "x".repeat(201) }), { ok: false, error: "invalid-name" });
});

test("the email must look like an email", () => {
  for (const email of ["", "mikey", "mikey@", "@example.com", "mikey@example", "mi key@example.com", "a@b@c.com", `${"x".repeat(250)}@e.co`]) {
    assert.deepEqual(newUser({ ...base, email }), { ok: false, error: "invalid-email" }, email);
  }
});

test("a staff account is required", () => {
  assert.deepEqual(newUser({ ...base, staffAccount: " " }), { ok: false, error: "invalid-staff-account" });
});

test("an invite needs a name, an email and at least one known role", () => {
  const base = { id: "11111111-1111-4111-8111-111111111111" as Id, invitedBy: "22222222-2222-4222-8222-222222222222" as Id };
  const made = newInvite({ ...base, name: " Sam Helper ", email: " Sam@Example.com ", roles: ["member", "manager", "member"] });
  assert.deepEqual(made, { ok: true, value: { ...base, name: "Sam Helper", email: "sam@example.com", roles: ["manager", "member"] } });
  assert.deepEqual(newInvite({ ...base, name: "", email: "sam@example.com", roles: ["member"] }), { ok: false, error: "invalid-name" });
  assert.deepEqual(newInvite({ ...base, name: "Sam", email: "sam", roles: ["member"] }), { ok: false, error: "invalid-email" });
  assert.deepEqual(newInvite({ ...base, name: "Sam", email: "sam@example.com", roles: [] }), { ok: false, error: "invalid-roles" });
  assert.deepEqual(newInvite({ ...base, name: "Sam", email: "sam@example.com", roles: ["owner"] }), { ok: false, error: "invalid-roles" });
});

test("the last active admin stays an admin", () => {
  assert.equal(mayStopBeingAdmin({ isAdmin: true, status: "active" }, 0), false);
  assert.equal(mayStopBeingAdmin({ isAdmin: true, status: "active" }, 1), true);
  assert.equal(mayStopBeingAdmin({ isAdmin: false, status: "active" }, 0), true);
  assert.equal(mayStopBeingAdmin({ isAdmin: true, status: "disabled" }, 0), true, "a disabled admin is already not counted");
});

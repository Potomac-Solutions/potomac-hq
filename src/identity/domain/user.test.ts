import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { newUser } from "./user.ts";

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

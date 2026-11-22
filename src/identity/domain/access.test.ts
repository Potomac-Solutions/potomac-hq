import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { can, type Access } from "./access.ts";
import { PERMISSIONS, ROLE_GRANTS, ROLE_KEYS, type RoleKey } from "./permissions.ts";
import type { User } from "./user.ts";

const user: User = {
  id: "11111111-1111-4111-8111-111111111111" as Id,
  staffAccount: "acct-1",
  name: "Test User",
  email: "test@example.com",
  status: "active",
};

function accessFor(role: RoleKey, over: Partial<User> = {}): Access {
  return { user: { ...user, ...over }, permissions: new Set(ROLE_GRANTS[role]) };
}

test("an admin may take every action", () => {
  for (const action of PERMISSIONS) assert.equal(can(accessFor("admin"), action), true, action);
});

test("a manager may not manage users or read the full audit history", () => {
  const manager = accessFor("manager");
  for (const action of ["user.invite", "user.set-status", "user.set-roles", "user.reset", "activity.view-all"]) {
    assert.equal(can(manager, action), false, action);
  }
  for (const action of ["opportunity.view-value", "opportunity.set-value", "opportunity.set-owner", "project.set-owner", "client.create"]) {
    assert.equal(can(manager, action), true, action);
  }
});

test("a member does client work but never sees or sets a deal's value", () => {
  const member = accessFor("member");
  for (const action of ["client.view", "client.create", "contact.edit", "opportunity.create", "opportunity.set-stage", "opportunity.convert", "project.view"]) {
    assert.equal(can(member, action), true, action);
  }
  for (const action of ["opportunity.view-value", "opportunity.set-value", "opportunity.set-owner", "project.set-owner", "user.invite", "activity.view-all"]) {
    assert.equal(can(member, action), false, action);
  }
});

test("each role is a subset of the one above it", () => {
  const admin = new Set(ROLE_GRANTS.admin);
  const manager = new Set(ROLE_GRANTS.manager);
  for (const p of ROLE_GRANTS.manager) assert.ok(admin.has(p), p);
  for (const p of ROLE_GRANTS.member) assert.ok(manager.has(p), p);
});

test("an action that is not in the matrix is refused for everyone", () => {
  for (const role of ROLE_KEYS) {
    for (const action of ["", "client.delete", "activity.edit", "activity.delete", "CLIENT.VIEW", "client.view ", "*"]) {
      assert.equal(can(accessFor(role), action), false, `${role} ${JSON.stringify(action)}`);
    }
  }
});

test("a disabled user can do nothing, even as an admin", () => {
  const disabled = accessFor("admin", { status: "disabled" });
  for (const action of PERMISSIONS) assert.equal(can(disabled, action), false, action);
});

test("no user can do nothing", () => {
  for (const action of PERMISSIONS) assert.equal(can(null, action), false, action);
});

test("a user with no roles can do nothing", () => {
  const none: Access = { user, permissions: new Set() };
  for (const action of PERMISSIONS) assert.equal(can(none, action), false, action);
});

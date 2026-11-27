import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLE_GRANTS, type Access, type IdentityUserStore, type RoleKey } from "../../identity/index.ts";
import type { Id } from "../../shared/index.ts";
import type { ActivityReader } from "./ports.ts";
import { recentActivity, type RecentActivityDeps } from "./recent-activity.ts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as Id;

function deps(access: Access | null): RecentActivityDeps & { asked: { scope: string; limit: number }[] } {
  const asked: { scope: string; limit: number }[] = [];
  const users: IdentityUserStore = {
    count: () => 1,
    insert: () => {},
    accessFor: () => access,
    findByStaffAccount: () => null,
    get: () => null,
    list: () => [],
    themeOf: () => "system",
    setTheme: () => {},
    morningEmailOf: () => true,
    setMorningEmail: () => {},
    findByEmail: () => null,
    rolesOf: () => [],
    setRoles: () => {},
    setStatus: () => {},
    activeAdminsOtherThan: () => 0, listEverybody: () => [], markRemoved: () => undefined,
  };
  const activity: ActivityReader = {
    forRecord: (recordType, recordId) => (recordType === "invoice" ? [{ id: id(3), occurredAt: "2026-11-15T03:00:00Z", action: "invoice.sent", actorName: "Mikey Nichols" }] : []),
    recent(scope, limit) {
      asked.push({ scope, limit });
      return [
        { id: id(1), occurredAt: "2026-11-15T02:03:00Z", action: "user.signed-in", actorName: "Mikey Nichols" },
        { id: id(2), occurredAt: "2026-11-15T02:00:00Z", action: "user.reset-link-issued", actorName: null },
      ];
    },
  };
  return { users, activity, formatWhen: (instant) => `at ${instant}`, asked };
}

function access(role: RoleKey | null, status: "active" | "disabled" = "active"): Access {
  return {
    user: { id: id(9), staffAccount: "acct", name: "Someone", email: "s@example.com", status },
    permissions: new Set(role ? ROLE_GRANTS[role] : []),
  };
}

test("an admin sees everything, worded for people, newest first as read", () => {
  const d = deps(access("admin"));
  const result = recentActivity(d, id(9));
  assert.deepEqual(result, {
    ok: true,
    value: {
      everything: true,
      items: [
        { id: id(1), text: "Mikey Nichols signed in", when: "at 2026-11-15T02:03:00Z", whenIso: "2026-11-15T02:03:00Z" },
        { id: id(2), text: "A password reset link was issued", when: "at 2026-11-15T02:00:00Z", whenIso: "2026-11-15T02:00:00Z" },
      ],
    },
  });
  assert.deepEqual(d.asked, [{ scope: "everything", limit: 20 }]);
});

test("a manager and a member are limited to client records", () => {
  for (const role of ["manager", "member"] as const) {
    const d = deps(access(role));
    const result = recentActivity(d, id(9));
    assert.ok(result.ok, role);
    assert.equal(result.value.everything, false, role);
    assert.deepEqual(d.asked, [{ scope: "client-records", limit: 20 }], role);
  }
});

test("without the permission, nothing is read", () => {
  const refused: (Access | null)[] = [null, access(null), access("admin", "disabled")];
  for (const who of refused) {
    const d = deps(who);
    assert.deepEqual(recentActivity(d, who ? id(9) : null), { ok: false, error: "forbidden" });
    assert.deepEqual(d.asked, [], "the reader was not called");
  }
});

test("holding dashboard.view alone is not enough", () => {
  const partial: Access = { ...access(null), permissions: new Set(["dashboard.view"]) };
  const d = deps(partial);
  assert.deepEqual(recentActivity(d, id(9)), { ok: false, error: "forbidden" });
  assert.deepEqual(d.asked, []);
});

test("a record's history is its own events, for someone who may see the record", async () => {
  const { recordHistory } = await import("./recent-activity.ts");
  const admin = deps(access("admin"));
  assert.equal(recordHistory(admin, id(9), "invoice", "inv-1").length, 1);
  assert.equal(recordHistory(admin, id(9), "invoice", "inv-1")[0]?.text, "Mikey Nichols sent an invoice");
  assert.deepEqual(recordHistory(deps(null), id(9), "invoice", "inv-1"), [], "nobody signed in");
  assert.deepEqual(recordHistory(admin, id(9), "user", "u-1"), [], "not a record with a history");
});

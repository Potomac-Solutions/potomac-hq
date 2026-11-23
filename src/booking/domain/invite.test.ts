import assert from "node:assert/strict";
import { test } from "node:test";
import { inviteDays, newInvite, startsFreeForBoth } from "./invite.ts";
import type { Id } from "../../shared/domain/id.ts";

const ids = { id: "1" as Id, organizationId: "2" as Id, clientUserId: "3" as Id, createdBy: "4" as Id };
const input = { title: "Kickoff call", minutes: "30", firstDay: "2026-11-30", lastDay: "2026-12-04" };

test("an invite has a title, a call length and up to two weeks of days, from today on", () => {
  assert.equal(newInvite(ids, input, "2026-11-23").ok, true);
  assert.deepEqual(newInvite(ids, { ...input, title: " " }, "2026-11-23"), { ok: false, error: "title-missing" });
  assert.deepEqual(newInvite(ids, { ...input, minutes: "25" }, "2026-11-23"), { ok: false, error: "call-length" });
  assert.deepEqual(newInvite(ids, { ...input, firstDay: "2026-11-20" }, "2026-11-23"), { ok: false, error: "days-in-past" });
  assert.deepEqual(newInvite(ids, { ...input, lastDay: "2026-11-29" }, "2026-11-23"), { ok: false, error: "days-backwards" });
  assert.deepEqual(newInvite(ids, { ...input, lastDay: "2026-12-14" }, "2026-11-23"), { ok: false, error: "days-too-many" });
  const made = newInvite(ids, input, "2026-11-23");
  assert.ok(made.ok);
  assert.deepEqual(inviteDays(made.value).map(String), ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
});

test("a call can start where both are free for long enough", () => {
  const at = (h: number, m = 0) => `2026-11-30T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
  const host = new Set([at(14), at(14, 30), at(15), at(16)]);
  const guest = new Set([at(14, 30), at(15), at(15, 30), at(16)]);
  assert.deepEqual(startsFreeForBoth(host, guest, 30), [at(14, 30), at(15), at(16)]);
  assert.deepEqual(startsFreeForBoth(host, guest, 60), [at(14, 30)], "an hour needs two half hours in a row");
  assert.deepEqual(startsFreeForBoth(host, guest, 90), []);
});

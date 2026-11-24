import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { guestName, newShareLink, shareState } from "./share.ts";

const ids = { id: "s" as Id, projectId: "p" as Id, createdBy: "u" as Id, createdAt: "2026-11-24T19:00:00Z" };
const TODAY = "2026-11-24";

test("a link has a name for who it's for, its rights, and maybe a last day", () => {
  const made = newShareLink(ids, { label: "  Dale at Better Days ", rights: "comment", expiresOn: "2026-12-31" }, TODAY);
  assert.ok(made.ok);
  assert.equal(made.value.label, "Dale at Better Days");
  assert.equal(made.value.rights, "comment");
  assert.equal(made.value.expiresOn, "2026-12-31");
  assert.equal(newShareLink(ids, { label: "Dale", rights: "see", expiresOn: "" }, TODAY).ok && newShareLink(ids, { label: "Dale", rights: "see" }, TODAY).ok, true);
  for (const [input, error] of [
    [{ label: " ", rights: "see" }, "label-missing"],
    [{ label: "x".repeat(81), rights: "see" }, "label-too-long"],
    [{ label: "Dale", rights: "edit" }, "invalid-rights"],
    [{ label: "Dale", rights: "see", expiresOn: "2026-02-30" }, "invalid-date"],
    [{ label: "Dale", rights: "see", expiresOn: "2026-11-23" }, "expiry-in-the-past"],
  ] as const) {
    assert.deepEqual(newShareLink(ids, input, TODAY), { ok: false, error }, JSON.stringify(input));
  }
});

test("a link works until it's stopped, or through its last day", () => {
  assert.equal(shareState({ stoppedAt: null, expiresOn: null }, TODAY), "live");
  assert.equal(shareState({ stoppedAt: null, expiresOn: TODAY }, TODAY), "live", "its last day still works");
  assert.equal(shareState({ stoppedAt: null, expiresOn: "2026-11-23" }, TODAY), "expired");
  assert.equal(shareState({ stoppedAt: "2026-11-20T10:00:00Z", expiresOn: null }, TODAY), "stopped");
});

test("a visitor's name", () => {
  assert.deepEqual(guestName("  Dale\n Ortiz "), { ok: true, value: "Dale Ortiz" });
  assert.deepEqual(guestName(" "), { ok: false, error: "guest-name-missing" });
  assert.deepEqual(guestName("x".repeat(61)), { ok: false, error: "guest-name-too-long" });
});

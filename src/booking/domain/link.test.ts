import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { checkLinkBooker, linkState, newLink } from "./link.ts";

const ids = { id: "l1" as Id, token: "t".repeat(32), createdBy: "u1" as Id };

test("a link has who it is for, and lasts a week, a month, three months or for good", () => {
  const made = newLink(ids, { label: "  Dana  at Elk Diner ", lasts: "30", oneTime: true }, "2026-11-23", "2026-11-23T14:00:00Z");
  assert.ok(made.ok);
  assert.equal(made.value.label, "Dana at Elk Diner");
  assert.equal(made.value.lastDay, "2026-12-23");
  assert.equal(newLink(ids, { label: "Anyone", lasts: "", oneTime: false }, "2026-11-23", "x").ok && true, true);
  assert.deepEqual(newLink(ids, { label: " ", lasts: "7", oneTime: false }, "2026-11-23", "x"), { ok: false, error: "label-missing" });
  assert.deepEqual(newLink(ids, { label: "x".repeat(81), lasts: "7", oneTime: false }, "2026-11-23", "x"), { ok: false, error: "label-too-long" });
  assert.deepEqual(newLink(ids, { label: "Dana", lasts: "365", oneTime: false }, "2026-11-23", "x"), { ok: false, error: "lasts-invalid" });
});

test("a link stops working when withdrawn, used once, or past its last day", () => {
  const link = { oneTime: false, lastDay: "2026-12-01", uses: 3, withdrawnAt: null };
  assert.equal(linkState(link, "2026-12-01"), "open", "its last day still works");
  assert.equal(linkState(link, "2026-12-02"), "ended");
  assert.equal(linkState({ ...link, oneTime: true }, "2026-11-25"), "used");
  assert.equal(linkState({ ...link, oneTime: true, uses: 0 }, "2026-11-25"), "open");
  assert.equal(linkState({ ...link, withdrawnAt: "2026-11-24T00:00:00Z" }, "2026-11-25"), "withdrawn");
});

test("booking with a link asks what the call is about and a phone number", () => {
  assert.deepEqual(checkLinkBooker({ phone: "304-555-0142", business: " Elk  Diner ", topic: "Online orders" }), { ok: true, value: { business: "Elk Diner" } });
  assert.deepEqual(checkLinkBooker({ phone: "304-555-0142", topic: " " }), { ok: false, error: "topic-missing" });
  assert.deepEqual(checkLinkBooker({ phone: "", topic: "Online orders" }), { ok: false, error: "phone-missing" });
  assert.deepEqual(checkLinkBooker({ phone: "304-555-0142", topic: "Online orders", business: "x".repeat(121) }), { ok: false, error: "business-too-long" });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanUrl, linkName, newProjectLink } from "./link.ts";
import type { Id } from "../../shared/domain/id.ts";

const ids = { id: "1" as Id, projectId: "2" as Id, createdBy: "3" as Id };

test("a web address is taken as typed, with https:// added when missing", () => {
  assert.equal(cleanUrl("staging.elkdiner.com"), "https://staging.elkdiner.com/");
  assert.equal(cleanUrl("https://github.com/Potomac-Solutions/elk-diner"), "https://github.com/Potomac-Solutions/elk-diner");
  assert.equal(cleanUrl("javascript:alert(1)"), null, "only web addresses");
  assert.equal(cleanUrl("not a url"), null);
  assert.equal(cleanUrl("localhost"), null);
});

test("a link has a kind, an address and, if wanted, its own name", () => {
  assert.deepEqual(newProjectLink(ids, { kind: "ftp", url: "x.com", shared: true }), { ok: false, error: "invalid-kind" });
  assert.deepEqual(newProjectLink(ids, { kind: "staging", url: "nope", shared: true }), { ok: false, error: "invalid-url" });
  const made = newProjectLink(ids, { kind: "design", label: " Menu mock-ups ", url: "figma.com/file/abc", shared: true });
  assert.ok(made.ok);
  assert.equal(linkName(made.value), "Menu mock-ups");
  assert.equal(linkName({ kind: "staging", label: "" }), "Staging site");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHref, pinnable } from "./pins.ts";

test("only HQ's own pages can be pinned", () => {
  for (const ok of ["/", "/clients/0f6c2f7e-1b2a-4c3d-8e9f-0a1b2c3d4e5f", "/work?label=web", "/calls/hours"]) assert.equal(pinnable(ok), true, ok);
  for (const no of ["", "//evil.example", "https://evil.example", "/assistant", "/nav/pin", "/staff/sign-out", "/activity.csv", "/a b", "/" + "x".repeat(400)]) assert.equal(pinnable(no), false, no);
});

test("a pin keeps the page's own filters, not a message or the open drawer", () => {
  assert.equal(cleanHref("/work?label=web&done=Saved.#top"), "/work?label=web");
  assert.equal(cleanHref("/clients/1?chat=open"), "/clients/1");
  assert.equal(cleanHref("/money"), "/money");
});

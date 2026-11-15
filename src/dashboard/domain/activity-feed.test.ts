import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAction, describeEvent } from "./activity-feed.ts";

test("known actions are worded for people", () => {
  assert.equal(describeEvent("user.signed-in", "Mikey Nichols"), "Mikey Nichols signed in");
  assert.equal(describeEvent("user.created", "Mikey Nichols"), "Mikey Nichols was added as a user");
});

test("an action HQ took by itself stands alone, capitalised", () => {
  assert.equal(describeEvent("user.reset-link-issued", null), "A password reset link was issued");
});

test("an action with no wording is shown by its key, never hidden", () => {
  assert.equal(describeAction("invoice.sent"), "invoice.sent");
  assert.equal(describeEvent("invoice.sent", "Mikey Nichols"), "Mikey Nichols invoice.sent");
});

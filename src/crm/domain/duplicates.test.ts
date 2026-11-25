import { test } from "node:test";
import assert from "node:assert/strict";
import { nameKey, sameBusiness } from "./duplicates.ts";

test("the same business, however it's typed", () => {
  assert.equal(nameKey("Better Days Towing, LLC"), "better days towing");
  for (const [a, b] of [["Better Days Towing", "better days towing llc"], ["Nu-Finish Collision", "Nu Finish Collision"], ["Better Days", "Better Days Towing"], ["Garrett County Adventures", "Garret County Adventures"], ["Smith & Sons", "Smith and Sons"]]) assert.equal(sameBusiness(a as string, b as string), true, `${a} / ${b}`);
});

test("different businesses aren't flagged", () => {
  for (const [a, b] of [["Elk Diner", "Elk Ridge Diner"], ["Moonshadow", "Firewater Kitchen"], ["The Co", "Inc"], ["ABC", "ABD"]]) assert.equal(sameBusiness(a as string, b as string), false, `${a} / ${b}`);
});

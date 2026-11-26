import assert from "node:assert/strict";
import { test } from "node:test";
import { portalTimeline } from "./timeline.ts";

const step = (id: string, done: boolean, yours = false) => ({ id, name: `Step ${id}`, when: done ? "Done" : "Due Friday", done, yours });

test("done keeps the newest three and counts the rest", () => {
  const timeline = portalTimeline({ steps: ["1", "2", "3", "4", "5"].map((id) => step(id, true)), toLookAt: [], toAnswer: [] });
  assert.deepEqual(timeline.done.map((one) => one.text), ["Step 3", "Step 4", "Step 5"]);
  assert.equal(timeline.more, 2);
  assert.deepEqual(timeline.next, []);
});

test("next is Potomac's open steps; the client's own steps wait on them", () => {
  const timeline = portalTimeline({ steps: [step("1", true), step("2", false, true), step("3", false), step("4", false), step("5", false)], toLookAt: [], toAnswer: [] });
  assert.deepEqual(timeline.next.map((one) => one.text), ["Step 3", "Step 4"]);
  assert.deepEqual(timeline.yours.map((one) => one.text), ["Step 2"]);
});

test("waiting on you lists what to look over and answer first, each linking to it", () => {
  const timeline = portalTimeline({ steps: [step("1", false, true)], toLookAt: [{ id: "d", title: "Home page design" }], toAnswer: [{ id: "c", title: "A second menu page" }] });
  assert.deepEqual(timeline.yours.map((one) => [one.text, one.href]), [
    ["Look over “Home page design” and approve it or ask for changes", "#deliverables"],
    ["Answer the change “A second menu page”", "#changes"],
    ["Step 1", "#files"],
  ]);
});

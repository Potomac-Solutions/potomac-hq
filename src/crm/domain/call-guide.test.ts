import assert from "node:assert/strict";
import { test } from "node:test";
import { callSummary, pickSituation, readGuide } from "./call-guide.ts";

const none = { hasProposalOrProject: false, proposalWaiting: false, activeProject: false, renewalSoon: false };

test("the guide follows what the client has, in order", () => {
  assert.equal(pickSituation(none), "first-call");
  assert.equal(pickSituation({ ...none, renewalSoon: true }), "first-call", "nothing sold yet is a first call");
  assert.equal(pickSituation({ ...none, hasProposalOrProject: true, proposalWaiting: true, activeProject: true }), "proposal-follow-up");
  assert.equal(pickSituation({ ...none, hasProposalOrProject: true, activeProject: true, renewalSoon: true }), "project-check-in");
  assert.equal(pickSituation({ ...none, hasProposalOrProject: true, renewalSoon: true }), "renewal");
  assert.equal(pickSituation({ ...none, hasProposalOrProject: true }), "any");
});

test("a guide is typed one question a line", () => {
  assert.deepEqual(readGuide({ title: " Intro ", questions: "1. Who are you?\n\n- What do you sell?\r\n• Why now?  " }), { ok: true, value: { title: "Intro", questions: ["Who are you?", "What do you sell?", "Why now?"] } });
  assert.deepEqual(readGuide({ title: "", questions: "x" }), { ok: false, error: "guide-title-missing" });
  assert.deepEqual(readGuide({ title: "x".repeat(81), questions: "x" }), { ok: false, error: "guide-title-too-long" });
  assert.deepEqual(readGuide({ title: "Intro", questions: " \n " }), { ok: false, error: "questions-missing" });
  assert.deepEqual(readGuide({ title: "Intro", questions: Array.from({ length: 21 }, (_, i) => `Q${i}`).join("\n") }), { ok: false, error: "too-many-questions" });
  assert.deepEqual(readGuide({ title: "Intro", questions: "x".repeat(201) }), { ok: false, error: "question-too-long" });
});

test("the call log keeps the notes, then what was asked and answered", () => {
  const answers = [
    { question: "Budget?", asked: true, answer: "Around $3,000." },
    { question: "Timeline?", asked: true, answer: "" },
    { question: "Who decides?", asked: false, answer: "" },
    { question: "Customers?", asked: false, answer: "Locals, mostly." },
  ];
  assert.equal(callSummary("Wants online booking.", answers), "Wants online booking.\n\n- Budget? Around $3,000.\n- Timeline? (asked)\n- Customers? Locals, mostly.");
  assert.equal(callSummary("", answers.slice(2, 3)), "");
  assert.equal(callSummary("  ", [answers[0]!]), "- Budget? Around $3,000.");
  assert.equal(callSummary("x".repeat(1990), answers).length, 2000);
});

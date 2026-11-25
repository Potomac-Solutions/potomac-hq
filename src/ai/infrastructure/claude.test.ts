// The AI drafts' Claude adapter against a stand-in: a refusal carries
// Anthropic's own reason, so the person can see what to fix.
import assert from "node:assert/strict";
import { test } from "node:test";
import { anthropicReason, claudeModel } from "./claude.ts";

const REQUEST = { model: "claude-haiku-5-5", system: "Be good.", user: "Hi", maxOutput: 100 };
const answering = (status: number, body: string) => async () => ({ status, text: async () => body });

test("a refused request says why, in Anthropic's words, on one line", async () => {
  const body = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low\nto access the API." } });
  const answer = await claudeModel(`sk-ant-${"x".repeat(30)}`, answering(400, body)).ask(REQUEST);
  assert.deepEqual(answer, { ok: false, problem: "Claude refused the request. Anthropic said: “Your credit balance is too low to access the API.”", inputCount: 0, outputCount: 0 });
  const plain = await claudeModel(`sk-ant-${"x".repeat(30)}`, answering(401, "{}")).ask(REQUEST);
  assert.equal(plain.ok ? "" : plain.problem, "The API key was refused. Check HQ_ANTHROPIC_API_KEY.");
  assert.equal(anthropicReason("<html>"), "");
});

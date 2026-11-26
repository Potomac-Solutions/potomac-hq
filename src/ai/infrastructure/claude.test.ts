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

test("a conversation sends its tools and messages, and keeps text and tool use from the answer (decision 0015)", async () => {
  let sent: Record<string, unknown> = {};
  const fetchFn = async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body) as Record<string, unknown>;
    return {
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "Looking." }, { type: "tool_use", id: "tu_1", name: "find", input: { query: "Better Days" } }], stop_reason: "tool_use", usage: { input_tokens: 120, output_tokens: 30 } }),
    };
  };
  const model = claudeModel(`sk-ant-${"x".repeat(30)}`, fetchFn as never);
  const tools = [{ name: "find", description: "Find things.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }];
  const answer = await model.converse?.({ model: "claude-haiku-5-5", system: "Help.", messages: [{ role: "user", content: [{ type: "text", text: "Find Better Days" }] }], tools, maxOutput: 500 });
  assert.deepEqual(sent["tools"], tools);
  assert.equal(sent["max_tokens"], 500);
  assert.deepEqual(answer, { ok: true, blocks: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "tu_1", name: "find", input: { query: "Better Days" } }], stopReason: "tool_use", inputCount: 120, outputCount: 30 });
  const refused = await claudeModel(`sk-ant-${"x".repeat(30)}`, answering(429, "{}")).converse?.({ model: "m", system: "", messages: [], tools: [], maxOutput: 10 });
  assert.equal(refused?.ok, false);
});

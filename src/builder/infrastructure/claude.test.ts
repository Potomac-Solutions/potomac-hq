// The Claude adapter against a stand-in for the Messages API: what it sends,
// how it reads a streamed answer split across chunks, and how it fails.
import assert from "node:assert/strict";
import { test } from "node:test";
import { anthropicReason, builderOwnersFrom, claudeApi, claudeConfigFrom } from "./claude.ts";
import { previewTokens } from "./preview-tokens.ts";

const CALL = { model: "claude-opus-5-5", system: "Be good.", tool: { name: "save_site", description: "Save.", input_schema: { type: "object" } }, message: "Make a site.", maxTokens: 32_000 };
const KEY = `sk-ant-api03-${"x".repeat(40)}`;

function streamOf(text: string, pieces = 7): Response {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil(bytes.length / pieces);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.slice(at, at + size));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const sse = (events: unknown[]) => events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");

test("the key and the owner are read from the environment and checked", () => {
  assert.equal(claudeConfigFrom({}), null);
  assert.deepEqual(claudeConfigFrom({ HQ_ANTHROPIC_API_KEY: ` ${KEY} ` }), { key: KEY });
  assert.throws(() => claudeConfigFrom({ HQ_ANTHROPIC_API_KEY: "hello" }), /doesn't look like a Claude API key/);
  assert.deepEqual(builderOwnersFrom({}), []);
  assert.deepEqual(builderOwnersFrom({ HQ_SITE_BUILDER_OWNER: " Mikey@Example.com " }), ["mikey@example.com"]);
  assert.deepEqual(builderOwnersFrom({ HQ_SITE_BUILDER_OWNER: "mikey@example.com, Jayanti@Example.com,,mikey@example.com" }), ["mikey@example.com", "jayanti@example.com"]);
  assert.throws(() => builderOwnersFrom({ HQ_SITE_BUILDER_OWNER: "mikey" }), /email/);
  assert.throws(() => builderOwnersFrom({ HQ_SITE_BUILDER_OWNER: "mikey@example.com; jayanti@example.com" }), /email/);
});

test("a refusal keeps Anthropic's reason, on one line, and nothing else from the body", async () => {
  const body = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: 32000 > 16000, which is the maximum\nallowed" } });
  const refuse: typeof fetch = async () => new Response(body, { status: 400 });
  assert.deepEqual(await claudeApi({ key: KEY }, { fetch: refuse }).ask(CALL), { ok: false, error: "refused", reason: "max_tokens: 32000 > 16000, which is the maximum allowed", inputTokens: 0, outputTokens: 0 });
  assert.equal(anthropicReason("not json"), "");
  assert.equal(anthropicReason("{}"), "");
  assert.equal(anthropicReason(JSON.stringify({ error: { message: "x".repeat(500) } })).length, 300);
});

test("a streamed answer is read across chunk boundaries, with its token counts", async () => {
  let sent: { url: string; init: RequestInit } | null = null;
  const fake: typeof fetch = async (url, init) => {
    sent = { url: String(url), init: init ?? {} };
    return streamOf(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 900, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "save_site", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"summary":"Made it.","write":[{"path":"index.html",' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"content":"<h1>Hi</h1>"}],"remove":[]}' } },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 77 } },
        { type: "message_stop" },
      ]),
    );
  };
  const answer = await claudeApi({ key: KEY }, { fetch: fake }).ask(CALL);
  assert.deepEqual(answer, { ok: true, input: { summary: "Made it.", write: [{ path: "index.html", content: "<h1>Hi</h1>" }], remove: [] }, inputTokens: 900, outputTokens: 77 });
  assert.ok(sent);
  const { url, init } = sent as { url: string; init: RequestInit };
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], KEY);
  assert.equal(headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  assert.equal(body["stream"], true);
  assert.equal(body["max_tokens"], 32_000);
  assert.deepEqual(body["tool_choice"], { type: "tool", name: "save_site" });
});

test("refusals, overloads, cut-off answers and lost connections are failures, still with their counts", async () => {
  const status = (code: number): typeof fetch => async () => new Response("{}", { status: code });
  assert.deepEqual(await claudeApi({ key: KEY }, { fetch: status(401) }).ask(CALL), { ok: false, error: "refused", inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(await claudeApi({ key: KEY }, { fetch: status(529) }).ask(CALL), { ok: false, error: "busy", inputTokens: 0, outputTokens: 0 });
  const unreachable: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await claudeApi({ key: KEY }, { fetch: unreachable }).ask(CALL), { ok: false, error: "failed", inputTokens: 0, outputTokens: 0 });
  const cutOff: typeof fetch = async () =>
    streamOf(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 10 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "save_site", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"summary":"' } },
        { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 32_000 } },
      ]),
    );
  assert.deepEqual(await claudeApi({ key: KEY }, { fetch: cutOff }).ask(CALL), { ok: false, error: "too-long", inputTokens: 10, outputTokens: 32_000 });
  const overloaded: typeof fetch = async () => streamOf(sse([{ type: "message_start", message: { usage: { input_tokens: 10 } } }, { type: "error", error: { type: "overloaded_error" } }]));
  assert.deepEqual(await claudeApi({ key: KEY }, { fetch: overloaded }).ask(CALL), { ok: false, error: "busy", inputTokens: 10, outputTokens: 0 });
});

test("a preview token opens one version for an hour, and can't be altered", () => {
  let now = Date.parse("2026-11-25T12:00:00Z");
  const tokens = previewTokens("secret-secret-secret-secret-secret", () => now);
  const id = "0190a000-0000-7000-8000-000000000001";
  const token = tokens.make(id as never, 3);
  assert.deepEqual(tokens.read(token), { buildId: id, version: 3 });
  assert.equal(tokens.read(token.replace(`${id}.3.`, `${id}.4.`)), null);
  assert.equal(previewTokens("another-secret-another-secret-xx", () => now).read(token), null);
  assert.equal(tokens.read("nonsense"), null);
  now += 61 * 60_000;
  assert.equal(tokens.read(token), null);
});

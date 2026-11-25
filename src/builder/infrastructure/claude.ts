// Talks to Claude through the Messages API, streamed (decision 0010,
// section 2). One call per request, no SDK: HQ keeps its dependencies few
// (decision 0001). The key is read from the environment and goes nowhere
// but the request's header.
import type { Claude, ClaudeAnswer, ClaudeError } from "../application/ports.ts";
import { EMPTY_STREAM, splitEvents, streamOutcome, streamStep, type StreamState } from "../domain/stream.ts";

const API = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";
/** Longest a whole answer may take. A 32,000-token answer streams in well under this. */
const TIMEOUT_MS = 15 * 60_000;

export type ClaudeConfig = { readonly key: string };

/**
 * null when the builder is not set up.
 *   HQ_ANTHROPIC_API_KEY   a Claude API key (sk-ant-...)
 */
export function claudeConfigFrom(env: NodeJS.ProcessEnv): ClaudeConfig | null {
  const key = (env["HQ_ANTHROPIC_API_KEY"] ?? "").trim();
  if (!key) return null;
  if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) throw new Error("HQ_ANTHROPIC_API_KEY doesn't look like a Claude API key (it starts sk-ant-).");
  return { key };
}

/**
 * The one person who may change the model and the cap: an email.
 *   HQ_SITE_BUILDER_OWNER
 */
export function builderOwnerFrom(env: NodeJS.ProcessEnv): string | null {
  const email = (env["HQ_SITE_BUILDER_OWNER"] ?? "").trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("HQ_SITE_BUILDER_OWNER must be an email address.");
  return email;
}

const failure = (status: number): ClaudeError => (status === 429 || status === 529 || status === 503 ? "busy" : status === 400 || status === 401 || status === 403 || status === 404 || status === 413 ? "refused" : "failed");

export function claudeApi(config: ClaudeConfig, deps: { readonly fetch?: typeof fetch } = {}): Claude {
  const send = deps.fetch ?? fetch;
  return {
    async ask(call): Promise<ClaudeAnswer> {
      let state: StreamState = EMPTY_STREAM;
      const counts = () => ({ inputTokens: state.input, outputTokens: state.output });
      let response: Response;
      try {
        response = await send(API, {
          method: "POST",
          headers: { "x-api-key": config.key, "anthropic-version": VERSION, "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({
            model: call.model,
            max_tokens: call.maxTokens,
            stream: true,
            system: call.system,
            tools: [call.tool],
            tool_choice: { type: "tool", name: call.tool.name },
            messages: [{ role: "user", content: call.message }],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        return { ok: false, error: "failed", ...counts() };
      }
      // A refused request is not billed. Its body is never kept: it may quote the request.
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, error: failure(response.status), ...counts() };
      }
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk as Uint8Array, { stream: true });
          const { data, rest } = splitEvents(buffer);
          buffer = rest;
          for (const line of data) {
            try {
              state = streamStep(state, JSON.parse(line), call.tool.name);
            } catch {
              // A line that isn't JSON is skipped; the outcome decides if the answer holds.
            }
          }
        }
        const { data } = splitEvents(`${buffer}\n`);
        for (const line of data) {
          try {
            state = streamStep(state, JSON.parse(line), call.tool.name);
          } catch {
            // As above.
          }
        }
      } catch {
        return { ok: false, error: "failed", ...counts() };
      }
      if (state.error) return { ok: false, error: state.error === "overloaded_error" || state.error === "rate_limit_error" ? "busy" : "failed", ...counts() };
      const outcome = streamOutcome(state);
      return outcome.ok ? { ok: true, input: outcome.input, ...counts() } : { ok: false, error: outcome.error === "too-long" ? "too-long" : outcome.error === "no-answer" ? "no-answer" : "failed", ...counts() };
    },
  };
}

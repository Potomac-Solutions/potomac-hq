// Claude through Anthropic's Messages API, with the key from
// HQ_ANTHROPIC_API_KEY. Plain fetch, no SDK. Never throws: a failure is an
// answer saying what went wrong, so a page or a job carries on without AI.
import type { AiModel, ChatBlock, ConverseAnswer, ModelAnswer, ModelRequest } from "../application/ports.ts";

/** Anthropic's error message from a refused request's body, on one line. "" when absent. */
export function anthropicReason(raw: string): string {
  try {
    const body = JSON.parse(raw) as { error?: { message?: unknown } };
    const message = typeof body.error?.message === "string" ? body.error.message : "";
    return message.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}

const API = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 60_000;

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

const PROBLEMS: Readonly<Record<number, string>> = {
  400: "Claude refused the request.",
  401: "The API key was refused. Check HQ_ANTHROPIC_API_KEY.",
  403: "The API key isn't allowed to use this model.",
  404: "Claude doesn't know that model. Check Settings → AI.",
  413: "The request was too big.",
  429: "Claude's rate limit was reached. Try again in a minute.",
  529: "Claude is overloaded. Try again in a minute.",
};

/** A key as Anthropic issues them. Anything else is refused at start-up. */
export const looksLikeAnthropicKey = (key: string): boolean => /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key.trim());

function contentOf(request: ModelRequest): unknown[] {
  const parts: unknown[] = [];
  for (const one of request.attachments ?? []) {
    parts.push(one.mediaType === "application/pdf" ? { type: "document", source: { type: "base64", media_type: one.mediaType, data: one.base64 } } : { type: "image", source: { type: "base64", media_type: one.mediaType, data: one.base64 } });
  }
  parts.push({ type: "text", text: request.user });
  return parts;
}

/** The blocks HQ keeps from an answer: text and tool use. Anything else (thinking, say) is left out. */
export function blocksOf(content: unknown): ChatBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: ChatBlock[] = [];
  for (const one of content as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown }[]) {
    if (one.type === "text" && typeof one.text === "string" && one.text.trim()) blocks.push({ type: "text", text: one.text });
    else if (one.type === "tool_use" && typeof one.id === "string" && typeof one.name === "string") {
      const input = one.input && typeof one.input === "object" && !Array.isArray(one.input) ? (one.input as Record<string, unknown>) : {};
      blocks.push({ type: "tool_use", id: one.id, name: one.name, input });
    }
  }
  return blocks;
}

export function claudeModel(apiKey: string, fetchFn: Fetch = fetch as unknown as Fetch): AiModel {
  const key = apiKey.trim();
  const post = async (body: unknown): Promise<{ status: number; raw: string } | { failed: string }> => {
    try {
      const response = await fetchFn(API, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { status: response.status, raw: await response.text() };
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { failed: timedOut ? "Claude took too long to answer." : "Couldn't reach Claude." };
    }
  };
  return {
    async converse(request): Promise<ConverseAnswer> {
      const sent = await post({ model: request.model, max_tokens: request.maxOutput, system: request.system, messages: request.messages, tools: request.tools });
      if ("failed" in sent) return { ok: false, problem: sent.failed, inputCount: 0, outputCount: 0 };
      let body: { content?: unknown; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string } = {};
      try {
        body = JSON.parse(sent.raw) as typeof body;
      } catch {
        // Handled below as no answer.
      }
      const inputCount = Number(body.usage?.input_tokens ?? 0) || 0;
      const outputCount = Number(body.usage?.output_tokens ?? 0) || 0;
      if (sent.status !== 200) {
        const reason = anthropicReason(sent.raw);
        const problem = PROBLEMS[sent.status] ?? `Claude answered ${sent.status}.`;
        return { ok: false, problem: reason ? `${problem} Anthropic said: “${reason}”` : problem, inputCount, outputCount };
      }
      const blocks = blocksOf(body.content);
      if (blocks.length === 0) return { ok: false, problem: "Claude's answer was empty.", inputCount, outputCount };
      return { ok: true, blocks, stopReason: body.stop_reason ?? "", inputCount, outputCount };
    },
    async ask(request): Promise<ModelAnswer> {
      let status = 0;
      let raw = "";
      try {
        const response = await fetchFn(API, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: request.model, max_tokens: request.maxOutput, system: request.system, messages: [{ role: "user", content: contentOf(request) }] }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        status = response.status;
        raw = await response.text();
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return { ok: false, problem: timedOut ? "Claude took too long to answer." : "Couldn't reach Claude.", inputCount: 0, outputCount: 0 };
      }
      let body: { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string } = {};
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        // Handled below as no answer.
      }
      const inputCount = Number(body.usage?.input_tokens ?? 0) || 0;
      const outputCount = Number(body.usage?.output_tokens ?? 0) || 0;
      if (status !== 200) {
        const reason = anthropicReason(raw);
        const problem = PROBLEMS[status] ?? `Claude answered ${status}.`;
        return { ok: false, problem: reason ? `${problem} Anthropic said: “${reason}”` : problem, inputCount, outputCount };
      }
      const text = (body.content ?? []).filter((one) => one.type === "text").map((one) => one.text ?? "").join("");
      if (!text) return { ok: false, problem: "Claude's answer was empty.", inputCount, outputCount };
      if (body.stop_reason === "max_tokens") return { ok: false, problem: "Claude's answer was cut off.", inputCount, outputCount };
      return { ok: true, text, inputCount, outputCount };
    },
  };
}

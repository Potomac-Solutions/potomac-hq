// Reading Claude's streamed answer. The Messages API sends server-sent
// events; each `data:` line is one JSON event. These fold them into what the
// builder needs: the tool's input, the token counts and why it stopped.
// Streaming keeps a long answer's connection busy, so nothing between HQ and
// the API closes it for being idle.

export type StreamState = {
  /** The tool input's JSON as it arrives, piece by piece. */
  readonly json: string;
  readonly toolSeen: boolean;
  readonly input: number;
  readonly output: number;
  readonly stopReason: string | null;
  /** An error event from the API, by its type, like "overloaded_error". */
  readonly error: string | null;
};

export const EMPTY_STREAM: StreamState = { json: "", toolSeen: false, input: 0, output: 0, stopReason: null, error: null };

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
const obj = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

/** Every input token billed: plain, written to the cache, and read from it. */
const inputOf = (usage: Record<string, unknown>): number => num(usage["input_tokens"]) + num(usage["cache_creation_input_tokens"]) + num(usage["cache_read_input_tokens"]);

/** One event's effect. Unknown events, like pings, change nothing. */
export function streamStep(state: StreamState, event: unknown, toolName: string): StreamState {
  const e = obj(event);
  switch (e["type"]) {
    case "message_start": {
      const usage = obj(obj(e["message"])["usage"]);
      return { ...state, input: Math.max(state.input, inputOf(usage)), output: Math.max(state.output, num(usage["output_tokens"])) };
    }
    case "content_block_start": {
      const block = obj(e["content_block"]);
      return block["type"] === "tool_use" && block["name"] === toolName ? { ...state, toolSeen: true } : state;
    }
    case "content_block_delta": {
      const delta = obj(e["delta"]);
      return delta["type"] === "input_json_delta" && state.toolSeen && typeof delta["partial_json"] === "string" ? { ...state, json: state.json + delta["partial_json"] } : state;
    }
    case "message_delta": {
      const usage = obj(e["usage"]);
      const stop = obj(e["delta"])["stop_reason"];
      return {
        ...state,
        // message_delta's counts are running totals: the latest one wins.
        output: Math.max(state.output, num(usage["output_tokens"])),
        input: Math.max(state.input, inputOf(usage)),
        stopReason: typeof stop === "string" ? stop : state.stopReason,
      };
    }
    case "error": {
      const type = obj(e["error"])["type"];
      return { ...state, error: typeof type === "string" ? type : "api_error" };
    }
    default:
      return state;
  }
}

/** The data lines of a chunk of server-sent events, keeping a partial last line for the next chunk. */
export function splitEvents(buffer: string): { readonly data: readonly string[]; readonly rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const data = lines.map((line) => line.replace(/\r$/, "")).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  return { data, rest };
}

export type StreamOutcome = { readonly ok: true; readonly input: unknown } | { readonly ok: false; readonly error: "too-long" | "no-answer" | "api-error" };

/** What the finished stream amounts to. */
export function streamOutcome(state: StreamState): StreamOutcome {
  if (state.error) return { ok: false, error: "api-error" };
  if (state.stopReason === "max_tokens") return { ok: false, error: "too-long" };
  if (!state.toolSeen) return { ok: false, error: "no-answer" };
  try {
    return { ok: true, input: JSON.parse(state.json || "{}") };
  } catch {
    return { ok: false, error: "no-answer" };
  }
}

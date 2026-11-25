import type { Build, BuildRequest, BuildVersion, RequestState } from "../domain/build.ts";
import type { Id } from "../../shared/index.ts";

/** A version without its files: for lists. */
export type VersionLine = Omit<BuildVersion, "filesJson">;

export type BuildStore = {
  insert(build: Build): void;
  saveBrief(id: Id, name: string, brief: string, at: string): void;
  get(id: Id): Build | null;
  /** Every build, the most recently changed first. */
  list(): (Build & { readonly updatedAt: string; readonly versions: number; readonly working: boolean })[];
  insertVersion(version: BuildVersion): void;
  /** A build's versions without their files, newest first. */
  versions(buildId: Id): VersionLine[];
  version(buildId: Id, number: number): BuildVersion | null;
  latest(buildId: Id): BuildVersion | null;
  insertRequest(request: BuildRequest): void;
  finishRequest(id: Id, finished: { readonly state: Exclude<RequestState, "working">; readonly costMicros: number; readonly inputTokens: number; readonly outputTokens: number; readonly error: string | null; readonly finishedAt: string }): void;
  request(id: Id): BuildRequest | null;
  /** A build's requests, oldest first. */
  requests(buildId: Id): BuildRequest[];
  /** Every request still working, on any build. */
  working(): BuildRequest[];
  /** Every request made since an instant, oldest first. */
  requestsSince(since: string): BuildRequest[];
};

export type BuilderSettings = { readonly model: string; readonly capCents: number };

export type BuilderSettingsStore = {
  get(): BuilderSettings;
  save(settings: BuilderSettings, at: string): void;
};

export type ClaudeCall = {
  readonly model: string;
  readonly system: string;
  readonly tool: { readonly name: string; readonly description: string; readonly input_schema: unknown };
  readonly message: string;
  readonly maxTokens: number;
};

/**
 * What came back. The token counts are known even when it failed partway,
 * because a failed answer is still billed for what it used.
 */
export type ClaudeAnswer =
  | { readonly ok: true; readonly input: unknown; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly ok: false; readonly error: ClaudeError; readonly inputTokens: number; readonly outputTokens: number };

/** refused: the key or the request was refused (401, 403, 400). busy: rate-limited or overloaded. */
export type ClaudeError = "refused" | "busy" | "failed" | "too-long" | "no-answer";

/** Sends one request to the Messages API. Never throws. */
export type Claude = { ask(call: ClaudeCall): Promise<ClaudeAnswer> };

/** Short-lived addresses for the preview frame (decision 0010, section 3). */
export type PreviewTokens = {
  /** A token for one version of one build, good for an hour. */
  make(buildId: Id, version: number): string;
  /** What a token is for, or null when it is wrong or expired. */
  read(token: string): { readonly buildId: Id; readonly version: number } | null;
};

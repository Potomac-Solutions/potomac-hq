import type { Build, BuildRequest, BuildVersion, RequestState } from "../domain/build.ts";
import type { BuildImage } from "../domain/image.ts";
import type { Id } from "../../shared/index.ts";

/** A version without its files: for lists. */
export type VersionLine = Omit<BuildVersion, "filesJson">;

export type BuildStore = {
  insert(build: Build): void;
  /** Keeps the old site's text, shown to Claude while the build has no files. */
  setReference(id: Id, from: string, text: string): void;
  reference(id: Id): { readonly from: string; readonly text: string } | null;
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

/** A build's photos and logo, with their bytes (decision 0010, slice 2). */
export type ImageStore = {
  insert(image: BuildImage, body: Uint8Array): void;
  get(id: Id): BuildImage | null;
  /** The image at a path in a build's site. */
  atPath(buildId: Id, path: string): BuildImage | null;
  body(id: Id): Uint8Array | null;
  /** A build's images, oldest first. */
  listFor(buildId: Id): BuildImage[];
  remove(id: Id): void;
};

export type RepoError = "github-not-set-up" | "repo-refused" | "repo-missing" | "repo-failed";

/** Reads a repository through GitHub (decision 0010, slice 3). Never throws. */
export type RepoReader = {
  /** The branch read (the default when none is given) and every file in it. */
  tree(repo: { readonly owner: string; readonly name: string; readonly branch: string | null }): Promise<{ readonly ok: true; readonly value: { readonly branch: string; readonly files: readonly { readonly path: string; readonly size: number; readonly sha: string }[] } } | { readonly ok: false; readonly error: RepoError }>;
  blob(repo: { readonly owner: string; readonly name: string }, sha: string): Promise<{ readonly ok: true; readonly value: Uint8Array } | { readonly ok: false; readonly error: RepoError }>;
};

export type PageError = "address-invalid" | "address-private" | "unreachable" | "too-large";

/** Reads one public web address, refusing anything inside a private network. */
export type PageFetch = (url: string) => Promise<{ readonly ok: true; readonly value: { readonly status: number; readonly text: string } } | { readonly ok: false; readonly error: PageError | string }>;

export type PublishError = "everyday-not-set-up" | "admin-not-set-up" | "repo-refused" | "repo-missing" | "repo-changed" | "repo-failed" | "repo-exists";
type PublishResult<T> = Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PublishError }>;
export type RepoName = { readonly owner: string; readonly name: string };

/**
 * Puts a version on GitHub (decision 0010, slice 4). `admin` calls use the
 * token that may make repositories; the rest use HQ's everyday one. Never throws.
 */
export type SitePublishing = {
  /** The organization new repositories are made under. */
  readonly organization: string;
  /** Whether it has the token that makes repositories. */
  readonly canCreate: boolean;
  /** Makes a private repository with a first commit on its main branch, and answers that branch. */
  createRepo(name: string, description: string): PublishResult<{ readonly branch: string }>;
  defaultBranch(repo: RepoName, admin: boolean): PublishResult<string>;
  /** One commit on `branch`, on top of what's there; made from `from` first when it's a new branch. Never forced. */
  commit(repo: RepoName, change: { readonly branch: string; readonly from: string | null; readonly message: string; readonly write: readonly { readonly path: string; readonly bytes: Uint8Array }[] }, admin: boolean): PublishResult<{ readonly commit: string }>;
  pullRequest(repo: RepoName, request: { readonly head: string; readonly base: string; readonly title: string; readonly body: string }): PublishResult<{ readonly url: string; readonly number: number }>;
};

/** A publish, as recorded. */
export type Publish = {
  readonly id: Id;
  readonly buildId: Id;
  readonly version: number;
  /** new-repo: the first publish made the repository; commit: a later one to it; pull-request: to a client's own repository. */
  readonly kind: "new-repo" | "commit" | "pull-request";
  readonly repo: string;
  readonly branch: string;
  readonly commit: string;
  readonly url: string;
  readonly by: Id;
  readonly at: string;
};

export type PublishStore = {
  insert(publish: Publish): void;
  /** A build's publishes, newest first. */
  listFor(buildId: Id): Publish[];
};

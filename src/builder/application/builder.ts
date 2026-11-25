// The site builder (decision 0010): client websites made with Claude in HQ.
// Permission: `site.build`, admins only, because it spends Potomac's money.
// The model and the monthly cap are changed only by the person whose email
// is HQ_SITE_BUILDER_OWNER.
//
// Asking Claude is two steps. `askClaude` checks everything, reserves the
// request's worst-case cost under the cap and records it as working, all in
// one transaction, so two requests at once can't both squeeze under the cap.
// Then the call runs in the background (`runLater`), and `finishRequest`
// records what it really cost and the version it made.
import { checkAsk, checkBuildInput, FIRST_ASK, LOST_AFTER_MS, monthStart, type Build, type BuildError, type BuildRequest } from "../domain/build.ts";
import { applyChange, fileAt, filesFromJson, filesToJson, totalChars, type FileError, type SiteFiles } from "../domain/files.ts";
import { costMicros, dollars, DEFAULT_MODEL, fitsUnderCap, MAX_OUTPUT_TOKENS, MODELS, modelById, parseCap, worstCaseMicros, centsToMicros, type CapError } from "../domain/pricing.ts";
import { readAnswer, SAVE_TOOL_SCHEMA, SYSTEM_PROMPT, userMessage, type ClientFacts } from "../domain/prompt.ts";
import { zipFiles } from "../domain/zip.ts";
import { checkImage, imagePath, MAX_IMAGES, type BuildImage, type ImageError } from "../domain/image.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { BuilderSettingsStore, BuildStore, Claude, ClaudeError, ImageStore, PageFetch, PreviewTokens, PublishStore, RepoReader, SitePublishing } from "./ports.ts";
import { suggestedRepoName } from "../domain/publish.ts";

export type BuilderDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly builds: BuildStore;
  /** Photos and a logo uploaded to builds. */
  readonly images: ImageStore;
  readonly settings: BuilderSettingsStore;
  /** Talks to Claude. Null when HQ_ANTHROPIC_API_KEY is not set. */
  readonly claude: Claude | null;
  readonly previewTokens: PreviewTokens;
  /** What a client's public website may say about them, or null when there is no such client. */
  readonly clientFacts: (organizationId: Id) => ClientFacts | null;
  /** Reads repositories to rework (slice 3). Null when HQ_GITHUB_TOKEN is not set. */
  readonly repos: RepoReader | null;
  /** Reads a public web address to rework (slice 3). */
  readonly fetchPage: PageFetch;
  /** Puts versions on GitHub (slice 4). Null when neither GitHub token is set. */
  readonly publishing: SitePublishing | null;
  readonly publishes: PublishStore;
  /** Sets a client's site up for editing (decision 0003) once it's in a new repository. True when it worked. */
  readonly setUpEditing?: (actorId: Id, organizationId: Id, input: { readonly name: string; readonly repo: string; readonly branch: string; readonly contentPath: string; readonly photoDir: string }) => Promise<boolean>;
  /** Every client, to start a build for. */
  readonly clients: () => readonly { readonly id: Id; readonly name: string }[];
  /** The email of the one person who may change the model and the cap. */
  readonly ownerEmail: string | null;
  readonly timeZone: string;
  readonly formatWhen: (instant: string) => string;
  /** Runs a job after the answer is sent. Its errors are logged by whoever runs it. */
  readonly runLater: (job: () => Promise<void>) => void;
  /**
   * What the AI drafts (decision 0012) have spent this month, in micro-dollars.
   * The cap is one budget shared with them (Mikey, 2026-11-25), so it counts too.
   */
  readonly alsoSpent?: () => number;
};

/** The settings have one record; their activity events point at this fixed id. */
const SETTINGS_ID = "00000000-0000-4000-8000-000000000010" as Id;
const may = (deps: BuilderDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "site.build").ok;

/** Whether this person may change the model and the cap. */
function isOwner(deps: BuilderDeps, actorId: Id | null): boolean {
  if (!may(deps, actorId) || !deps.ownerEmail) return false;
  return deps.users.get(actorId)?.email.toLowerCase() === deps.ownerEmail.toLowerCase();
}

/** The chosen model, or the default when the stored one is no longer priced. */
function currentModel(deps: BuilderDeps) {
  const settings = deps.settings.get();
  return modelById(settings.model) ?? modelById(DEFAULT_MODEL) ?? (MODELS[0] as NonNullable<ReturnType<typeof modelById>>);
}

/** What the site builder has spent this month: finished requests at their cost, working ones at what they reserved. */
export function builderSpentThisMonth(deps: Pick<BuilderDeps, "builds" | "clock" | "timeZone">): number {
  return deps.builds.requestsSince(monthStart(deps.clock(), deps.timeZone)).reduce((sum, one) => sum + (one.state === "working" ? one.reservedMicros : one.costMicros), 0);
}

/** What this month has spent against the shared cap: the site builder and the AI drafts together. */
function spentThisMonth(deps: BuilderDeps): number {
  return builderSpentThisMonth(deps) + (deps.alsoSpent?.() ?? 0);
}

export type BudgetLine = { readonly spent: string; readonly cap: string; readonly left: string; readonly percent: number; readonly drafts: string };

function budgetLine(deps: BuilderDeps): BudgetLine {
  const spent = spentThisMonth(deps);
  const cap = centsToMicros(deps.settings.get().capCents);
  const drafts = deps.alsoSpent?.() ?? 0;
  return { spent: dollars(spent), cap: dollars(cap), left: dollars(Math.max(0, cap - spent)), percent: cap === 0 ? 100 : Math.min(100, Math.round((spent / cap) * 100)), drafts: drafts > 0 ? dollars(drafts) : "" };
}

// ---------------------------------------------------------------------------
// The list of builds, and starting one

export type BuildsView = {
  readonly builds: readonly { readonly id: Id; readonly name: string; readonly client: string; readonly versions: number; readonly updated: string; readonly working: boolean }[];
  readonly clients: readonly { readonly id: Id; readonly name: string }[];
  readonly budget: BudgetLine;
  readonly model: string;
  readonly claudeSetUp: boolean;
  /** Whether repositories can be read to rework. */
  readonly githubSetUp: boolean;
};

/** Sites → Site builder. Permission: `site.build`. */
export function buildsView(deps: BuilderDeps, actorId: Id | null): Result<BuildsView, "forbidden"> {
  if (!may(deps, actorId)) return err("forbidden");
  const clients = deps.clients();
  const nameOf = (id: Id) => clients.find((one) => one.id === id)?.name ?? "A client no longer in HQ";
  return ok({
    builds: deps.builds.list().map((one) => ({ id: one.id, name: one.name, client: nameOf(one.organizationId), versions: one.versions, updated: deps.formatWhen(one.updatedAt), working: one.working })),
    clients,
    budget: budgetLine(deps),
    model: currentModel(deps).label,
    claudeSetUp: deps.claude !== null,
    githubSetUp: deps.repos !== null,
  });
}

export type StartError = "forbidden" | "no-such-client" | BuildError;

/**
 * Starts a build for a client, and asks Claude for its first version. The
 * build is kept even when the first request can't go (no key, over the
 * cap); `first` says what happened to it.
 */
export function startBuild(deps: BuilderDeps, actorId: Id | null, input: { readonly organizationId: string; readonly name: string; readonly brief: string }): Result<{ readonly build: Build; readonly first: Result<Build, AskError> }, StartError> {
  if (!may(deps, actorId)) return err("forbidden");
  const client = deps.clients().find((one) => one.id === input.organizationId);
  if (!client) return err("no-such-client");
  const checked = checkBuildInput(input);
  if (!checked.ok) return checked;
  const build: Build = { id: deps.newId(), organizationId: client.id, name: checked.value.name, brief: checked.value.brief, createdBy: actorId, createdAt: deps.clock() };
  deps.transact(() => {
    deps.builds.insert(build);
    recordActivity(deps, { actorId, action: "build.started", recordType: "build", recordId: build.id, context: { client: client.name } });
  });
  return ok({ build, first: askClaude(deps, actorId, build.id, FIRST_ASK) });
}

/** Changes a build's name and brief. The next request uses them. Permission: `site.build`. */
export function saveBrief(deps: BuilderDeps, actorId: Id | null, buildId: Id, input: { readonly name: string; readonly brief: string }): Result<Build, "forbidden" | "not-found" | BuildError> {
  if (!may(deps, actorId)) return err("forbidden");
  const build = deps.builds.get(buildId);
  if (!build) return err("not-found");
  const checked = checkBuildInput(input);
  if (!checked.ok) return checked;
  return deps.transact(() => {
    deps.builds.saveBrief(build.id, checked.value.name, checked.value.brief, deps.clock());
    recordActivity(deps, { actorId, action: "build.brief-changed", recordType: "build", recordId: build.id, context: { renamed: checked.value.name !== build.name } });
    return ok({ ...build, ...checked.value });
  });
}

// ---------------------------------------------------------------------------
// One build's page

export type BuildView = {
  readonly id: Id;
  /** Where it was reworked from, or "". */
  readonly referenceFrom: string;
  readonly name: string;
  readonly brief: string;
  readonly client: string;
  readonly organizationId: Id;
  /** The version shown: the newest unless another was asked for. 0 when there are none yet. */
  readonly shown: number;
  readonly newest: number;
  readonly previewSrc: string;
  readonly fileCount: number;
  readonly size: string;
  readonly versions: readonly { readonly number: number; readonly summary: string; readonly when: string; readonly by: string; readonly current: boolean }[];
  readonly conversation: readonly { readonly ask: string; readonly by: string; readonly when: string; readonly state: string; readonly answer: string; readonly cost: string; readonly version: number | null }[];
  readonly working: boolean;
  readonly budget: BudgetLine;
  readonly model: string;
  readonly claudeSetUp: boolean;
  readonly images: readonly { readonly id: Id; readonly path: string; readonly kind: string; readonly kindLabel: string; readonly alt: string; readonly size: string; readonly src: string }[];
  readonly canAddImage: boolean;
  /** Where the next publish goes, once there has been one: "" before. */
  readonly publishedTo: string;
  readonly publishes: readonly { readonly version: number; readonly kind: string; readonly where: string; readonly url: string; readonly when: string; readonly by: string }[];
  readonly suggestedRepo: string;
  readonly organization: string;
  readonly githubSetUp: boolean;
  readonly adminSetUp: boolean;
};

const ERROR_WORDS: Readonly<Record<string, string>> = {
  refused: "The Claude API refused the request. Check HQ_ANTHROPIC_API_KEY and the account's credit.",
  busy: "Claude was busy or rate-limited. Ask again in a minute.",
  failed: "HQ couldn’t reach the Claude API. Ask again in a minute.",
  "too-long": "The answer ran past the longest Claude may write at once. Ask for less in one go, a page at a time.",
  "no-answer": "Claude didn’t answer in the shape HQ reads. Ask again.",
  "answer-unreadable": "Claude didn’t answer in the shape HQ reads. Ask again.",
  "path-invalid": "Claude tried to write a file with a name HQ doesn’t allow. Ask again.",
  "type-not-allowed": "Claude tried to write a kind of file a static site doesn’t use. Ask again.",
  "too-many-files": "That would make more than 60 files. Ask for fewer pages or join some files.",
  "site-too-large": "That would make the site bigger than HQ keeps. Ask for something smaller.",
  "no-home-page": "That would leave the site with no index.html. Ask again.",
  lost: "This request was lost, likely when HQ restarted. Ask again.",
};

/** A build, its versions and its conversation. `version` shows an older one. Permission: `site.build`. */
export function buildView(deps: BuilderDeps, actorId: Id | null, buildId: Id, version: number | null): Result<BuildView, "forbidden" | "not-found"> {
  if (!may(deps, actorId)) return err("forbidden");
  const build = deps.builds.get(buildId);
  if (!build) return err("not-found");
  const versions = deps.builds.versions(build.id);
  const newest = versions[0]?.number ?? 0;
  const shownLine = version === null ? versions[0] : versions.find((one) => one.number === version);
  if (version !== null && !shownLine) return err("not-found");
  const shown = shownLine?.number ?? 0;
  const nameOf = (id: Id | null) => (id ? (deps.users.get(id)?.name ?? "Someone") : "Claude");
  const requests = deps.builds.requests(build.id);
  const versionOf = new Map(versions.filter((one) => one.requestId).map((one) => [one.requestId as Id, one.number]));
  return ok({
    id: build.id,
    referenceFrom: build.referenceFrom ?? "",
    name: build.name,
    brief: build.brief,
    client: deps.clientFacts(build.organizationId)?.name ?? "A client no longer in HQ",
    organizationId: build.organizationId,
    shown,
    newest,
    previewSrc: shown > 0 ? `/builder/preview/${deps.previewTokens.make(build.id, shown)}/` : "",
    fileCount: shown > 0 ? Object.keys(filesFromJson(deps.builds.version(build.id, shown)?.filesJson ?? "{}")).length : 0,
    size: shownLine ? `${Math.max(1, Math.round(shownLine.chars / 1000))} KB` : "",
    versions: versions.map((one) => ({ number: one.number, summary: one.summary, when: deps.formatWhen(one.createdAt), by: one.madeBy ? nameOf(one.madeBy) : "Claude", current: one.number === shown })),
    conversation: requests.map((one) => ({
      ask: one.ask,
      by: nameOf(one.askedBy),
      when: deps.formatWhen(one.createdAt),
      state: one.state,
      answer: one.state === "working" ? "Claude is working on it…" : one.state === "failed" ? (ERROR_WORDS[one.error ?? ""] ?? "That didn’t work. Ask again.") : (versions.find((v) => v.requestId === one.id)?.summary ?? ""),
      cost: one.state === "working" ? `up to ${dollars(one.reservedMicros)}` : dollars(one.costMicros),
      version: versionOf.get(one.id) ?? null,
    })),
    working: requests.some((one) => one.state === "working"),
    budget: budgetLine(deps),
    model: currentModel(deps).label,
    claudeSetUp: deps.claude !== null,
    images: deps.images.listFor(build.id).map((one) => ({ id: one.id, path: one.path, kind: one.kind, kindLabel: one.kind === "logo" ? "Logo" : "Photo", alt: one.alt, size: `${one.width} × ${one.height}`, src: `/builder/${build.id}/images/${one.id}` })),
    canAddImage: deps.images.listFor(build.id).length < MAX_IMAGES,
    ...publishing(deps, build),
  });
}

/** The going-live part of a build's page (slice 4). */
function publishing(deps: BuilderDeps, build: Build) {
  const all = deps.publishes.listFor(build.id);
  const last = all[0];
  return {
    publishedTo: !last ? "" : last.kind === "pull-request" ? `a pull request to ${last.repo}, into ${last.branch}` : `${last.repo}, straight onto ${last.branch}`,
    publishes: all.map((one) => ({
      version: one.version,
      kind: one.kind === "pull-request" ? "Pull request" : one.kind === "new-repo" ? "New repository" : "Commit",
      where: one.kind === "pull-request" ? `${one.repo}, into ${one.branch}` : `${one.repo}, ${one.branch}`,
      url: one.url,
      when: deps.formatWhen(one.at),
      by: deps.users.get(one.by)?.name ?? "Someone",
    })),
    suggestedRepo: suggestedRepoName(deps.clientFacts(build.organizationId)?.name ?? build.name),
    organization: deps.publishing?.organization ?? "",
    githubSetUp: deps.publishing !== null,
    adminSetUp: deps.publishing !== null && deps.publishing.canCreate,
  };
}

// ---------------------------------------------------------------------------
// Images (slice 2)

/** Adds a photo or a logo to a build. Claude may use it from the next request. Permission: `site.build`. */
export function addImage(deps: BuilderDeps, actorId: Id | null, buildId: Id, input: { readonly kind: string; readonly alt: string; readonly bytes: Uint8Array | null }): Result<BuildImage, "forbidden" | "not-found" | ImageError> {
  if (!may(deps, actorId)) return err("forbidden");
  const build = deps.builds.get(buildId);
  if (!build) return err("not-found");
  return deps.transact(() => {
    const checked = checkImage(input, deps.images.listFor(build.id).length);
    if (!checked.ok) return checked;
    const id = deps.newId();
    const image: BuildImage = { id, buildId: build.id, path: imagePath(id, checked.value.kind, checked.value.type), kind: checked.value.kind, contentType: checked.value.type.contentType, width: checked.value.width, height: checked.value.height, alt: checked.value.alt, bytes: (input.bytes as Uint8Array).length, addedBy: actorId, createdAt: deps.clock() };
    deps.images.insert(image, input.bytes as Uint8Array);
    recordActivity(deps, { actorId, action: "build.image-added", recordType: "build", recordId: build.id, context: { kind: image.kind, path: image.path } });
    return ok(image);
  });
}

/**
 * Removes an image from a build. A version that shows it shows a missing
 * picture from then on, in the preview and the zip. Permission: `site.build`.
 */
export function removeImage(deps: BuilderDeps, actorId: Id | null, buildId: Id, imageId: string): Result<Build, "forbidden" | "not-found"> {
  if (!may(deps, actorId)) return err("forbidden");
  const build = deps.builds.get(buildId);
  const image = build ? deps.images.get(imageId as Id) : null;
  if (!build || !image || image.buildId !== build.id) return err("not-found");
  return deps.transact(() => {
    deps.images.remove(image.id);
    recordActivity(deps, { actorId, action: "build.image-removed", recordType: "build", recordId: build.id, context: { kind: image.kind, path: image.path } });
    return ok(build);
  });
}

/** An image's bytes, for its thumbnail on the build page. Permission: `site.build`. */
export function imageFor(deps: BuilderDeps, actorId: Id | null, buildId: Id, imageId: Id): { readonly body: Uint8Array; readonly contentType: string } | null {
  if (!may(deps, actorId)) return null;
  const image = deps.images.get(imageId);
  const body = image && image.buildId === buildId ? deps.images.body(image.id) : null;
  return image && body ? { body, contentType: image.contentType } : null;
}

// ---------------------------------------------------------------------------
// Asking Claude

export type AskError = "forbidden" | "not-found" | "claude-not-set-up" | "busy-build" | "over-cap" | BuildError;

/**
 * Asks Claude for a change to a build. Refused before anything is sent when
 * its worst case would pass this month's cap. Permission: `site.build`.
 */
export function askClaude(deps: BuilderDeps, actorId: Id | null, buildId: Id, text: string): Result<Build, AskError> {
  if (!may(deps, actorId)) return err("forbidden");
  const build = deps.builds.get(buildId);
  if (!build) return err("not-found");
  const claude = deps.claude;
  if (!claude) return err("claude-not-set-up");
  const ask = checkAsk(text);
  if (!ask.ok) return ask;
  const facts = deps.clientFacts(build.organizationId) ?? { name: "(unknown)", phone: null, address: null, website: null, contact: null };
  const latest = deps.builds.latest(build.id);
  const files = filesFromJson(latest?.filesJson ?? "{}");
  const summaries = new Map(deps.builds.versions(build.id).map((one) => [one.requestId, one.summary]));
  const history = deps.builds
    .requests(build.id)
    .filter((one) => one.state === "done")
    .map((one) => ({ ask: one.ask, summary: summaries.get(one.id) ?? "" }));
  const images = deps.images.listFor(build.id).map((one) => ({ path: one.path, kind: one.kind, width: one.width, height: one.height, alt: one.alt }));
  // The old site goes with every request until the build has files of its own.
  const reference = Object.keys(files).length === 0 ? deps.builds.reference(build.id) : null;
  const message = userMessage({ facts, brief: build.brief, files, history, images, reference, ask: ask.value });
  const model = currentModel(deps);
  const reserve = worstCaseMicros(model, SYSTEM_PROMPT.length + JSON.stringify(SAVE_TOOL_SCHEMA).length + message.length);
  const requestId = deps.newId();
  const started = deps.transact((): Result<true, AskError> => {
    if (deps.builds.requests(build.id).some((one) => one.state === "working")) return err("busy-build");
    if (!fitsUnderCap(spentThisMonth(deps), reserve, deps.settings.get().capCents)) return err("over-cap");
    deps.builds.insertRequest({ id: requestId, buildId: build.id, askedBy: actorId, ask: ask.value, model: model.id, state: "working", reservedMicros: reserve, costMicros: 0, inputTokens: 0, outputTokens: 0, error: null, createdAt: deps.clock(), finishedAt: null });
    recordActivity(deps, { actorId, action: "build.asked", recordType: "build", recordId: build.id, context: { model: model.id, reservedMicros: reserve } });
    return ok(true);
  });
  if (!started.ok) return started;
  deps.runLater(async () => {
    const answer = await claude.ask({ model: model.id, system: SYSTEM_PROMPT, tool: SAVE_TOOL_SCHEMA, message, maxTokens: MAX_OUTPUT_TOKENS });
    finishRequest(deps, requestId, files, answer);
  });
  return ok(build);
}

/**
 * Records what a request cost and, if Claude's answer is sound, the version
 * it made. HQ does this itself, so the version and the event have no actor.
 */
export function finishRequest(deps: BuilderDeps, requestId: Id, before: SiteFiles, answer: Awaited<ReturnType<Claude["ask"]>>): void {
  const request = deps.builds.request(requestId);
  if (!request || request.state !== "working") return;
  const model = modelById(request.model) ?? currentModel(deps);
  const cost = costMicros(model, { input: answer.inputTokens, output: answer.outputTokens });
  const tokens = { inputTokens: answer.inputTokens, outputTokens: answer.outputTokens };
  let error: ClaudeError | FileError | "answer-unreadable" | null = answer.ok ? null : answer.error;
  let next: SiteFiles | null = null;
  let summary = "";
  if (answer.ok) {
    const read = readAnswer(answer.input);
    if (!read.ok) error = read.error;
    else {
      const applied = applyChange(before, read.value);
      if (!applied.ok) error = applied.error;
      else {
        next = applied.value;
        summary = read.value.summary;
      }
    }
  }
  const at = deps.clock();
  deps.transact(() => {
    if (next === null) {
      deps.builds.finishRequest(request.id, { state: "failed", costMicros: cost, ...tokens, error, finishedAt: at });
      recordActivity(deps, { actorId: null, action: "build.request-failed", recordType: "build", recordId: request.buildId, context: { reason: error ?? "failed", costMicros: cost } });
      return;
    }
    const number = (deps.builds.latest(request.buildId)?.number ?? 0) + 1;
    deps.builds.insertVersion({ buildId: request.buildId, number, requestId: request.id, madeBy: null, summary, filesJson: filesToJson(next), chars: totalChars(next), createdAt: at });
    deps.builds.finishRequest(request.id, { state: "done", costMicros: cost, ...tokens, error: null, finishedAt: at });
    recordActivity(deps, { actorId: null, action: "build.version-made", recordType: "build", recordId: request.buildId, context: { version: number, files: Object.keys(next).length, costMicros: cost } });
  });
}

/**
 * Requests left working long past any answer: lost when HQ restarted
 * mid-request. Each is failed and counted at what it reserved, since the API
 * may have billed it. Run on start and every few minutes. Answers how many.
 */
export function failLostRequests(deps: BuilderDeps): number {
  const cutoff = Date.parse(deps.clock()) - LOST_AFTER_MS;
  const lost = deps.builds.working().filter((one) => Date.parse(one.createdAt) < cutoff);
  for (const one of lost) {
    deps.transact(() => {
      deps.builds.finishRequest(one.id, { state: "failed", costMicros: one.reservedMicros, inputTokens: 0, outputTokens: 0, error: "lost", finishedAt: deps.clock() });
      recordActivity(deps, { actorId: null, action: "build.request-failed", recordType: "build", recordId: one.buildId, context: { reason: "lost", costMicros: one.reservedMicros } });
    });
  }
  return lost.length;
}

/** Makes an older version the newest, as a new version. Permission: `site.build`. */
export function restoreVersion(deps: BuilderDeps, actorId: Id | null, buildId: Id, number: number): Result<Build, "forbidden" | "not-found" | "busy-build" | "already-newest"> {
  if (!may(deps, actorId)) return err("forbidden");
  const build = deps.builds.get(buildId);
  const old = build ? deps.builds.version(build.id, number) : null;
  if (!build || !old) return err("not-found");
  return deps.transact(() => {
    if (deps.builds.requests(build.id).some((one) => one.state === "working")) return err("busy-build");
    const newest = deps.builds.latest(build.id)?.number ?? 0;
    if (newest === number) return err("already-newest");
    deps.builds.insertVersion({ buildId: build.id, number: newest + 1, requestId: null, madeBy: actorId, summary: `Restored version ${number}.`, filesJson: old.filesJson, chars: old.chars, createdAt: deps.clock() });
    recordActivity(deps, { actorId, action: "build.restored", recordType: "build", recordId: build.id, context: { from: number, version: newest + 1 } });
    return ok(build);
  });
}

/** A version as a .zip, for a client who hosts it themselves. Permission: `site.build`. */
export function versionZip(deps: BuilderDeps, actorId: Id | null, buildId: Id, number: number): Result<{ readonly name: string; readonly bytes: Uint8Array<ArrayBuffer> }, "forbidden" | "not-found"> {
  if (!may(deps, actorId)) return err("forbidden");
  const build = deps.builds.get(buildId);
  const version = build ? deps.builds.version(build.id, number) : null;
  if (!build || !version) return err("not-found");
  const slug = build.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
  // The build's images go with every version's files: they're not part of a version.
  const images = Object.fromEntries(deps.images.listFor(build.id).flatMap((one) => {
    const body = deps.images.body(one.id);
    return body ? [[one.path, body] as const] : [];
  }));
  return ok({ name: `${slug}-v${number}.zip`, bytes: zipFiles({ ...filesFromJson(version.filesJson), ...images }, slug, new Date(deps.clock())) });
}

/** One file of a version, for the preview frame. The token is the only key: the frame sends no cookies. */
export function previewFile(deps: BuilderDeps, token: string, path: string): { readonly content: string | Uint8Array; readonly type: string } | null {
  const target = deps.previewTokens.read(token);
  if (!target) return null;
  const version = deps.builds.version(target.buildId, target.version);
  if (!version) return null;
  const file = fileAt(filesFromJson(version.filesJson), path);
  if (file) return file;
  // A picture: uploaded, or kept at its old path from a reworked site.
  const image = path ? deps.images.atPath(target.buildId, path) : null;
  const body = image ? deps.images.body(image.id) : null;
  return image && body ? { content: body, type: image.contentType } : null;
}

// ---------------------------------------------------------------------------
// The model and the cap

export type BuilderSettingsView = {
  readonly models: readonly { readonly id: string; readonly label: string; readonly price: string; readonly selected: boolean }[];
  readonly model: string;
  readonly cap: string;
  readonly canChange: boolean;
  readonly ownerSet: boolean;
  readonly claudeSetUp: boolean;
  readonly budget: BudgetLine;
  readonly byPerson: readonly { readonly name: string; readonly spent: string }[];
  readonly byBuild: readonly { readonly name: string; readonly spent: string }[];
  readonly months: readonly { readonly month: string; readonly spent: string; readonly requests: number }[];
};

const spentOf = (one: BuildRequest) => (one.state === "working" ? one.reservedMicros : one.costMicros);

function totals<K>(requests: readonly BuildRequest[], keyOf: (one: BuildRequest) => K): Map<K, number> {
  const out = new Map<K, number>();
  for (const one of requests) out.set(keyOf(one), (out.get(keyOf(one)) ?? 0) + spentOf(one));
  return out;
}

/** The settings page. Permission: `site.build`; changing them is the owner's alone. */
export function builderSettingsView(deps: BuilderDeps, actorId: Id | null): Result<BuilderSettingsView, "forbidden"> {
  if (!may(deps, actorId)) return err("forbidden");
  const settings = deps.settings.get();
  const model = currentModel(deps);
  const now = Temporal.Instant.from(deps.clock()).toZonedDateTimeISO(deps.timeZone);
  const thisMonth = monthStart(deps.clock(), deps.timeZone);
  const sixMonths = now.with({ day: 1 }).startOfDay().subtract({ months: 5 }).toInstant().toString();
  const recent = deps.builds.requestsSince(sixMonths);
  const month = recent.filter((one) => one.createdAt >= thisMonth);
  const byMonth = new Map<string, { micros: number; requests: number }>();
  for (const one of recent) {
    const key = Temporal.Instant.from(one.createdAt).toZonedDateTimeISO(deps.timeZone).toPlainDate().toPlainYearMonth().toString();
    const was = byMonth.get(key) ?? { micros: 0, requests: 0 };
    byMonth.set(key, { micros: was.micros + spentOf(one), requests: was.requests + 1 });
  }
  const names = new Map(deps.builds.list().map((one) => [one.id, one.name]));
  return ok({
    models: MODELS.map((one) => ({ id: one.id, label: one.label, price: `$${one.input} in, $${one.output} out per million tokens`, selected: one.id === model.id })),
    model: model.label,
    cap: (settings.capCents / 100).toFixed(2),
    canChange: isOwner(deps, actorId),
    ownerSet: deps.ownerEmail !== null,
    claudeSetUp: deps.claude !== null,
    budget: budgetLine(deps),
    byPerson: [...totals(month, (one) => one.askedBy)].map(([id, micros]) => ({ name: deps.users.get(id)?.name ?? "Someone", spent: dollars(micros) })),
    byBuild: [...totals(month, (one) => one.buildId)].map(([id, micros]) => ({ name: names.get(id) ?? "A build", spent: dollars(micros) })),
    months: [...byMonth]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([key, one]) => ({ month: Temporal.PlainDate.from(`${key}-01`).toLocaleString("en-US", { month: "long", year: "numeric" }), spent: dollars(one.micros), requests: one.requests })),
  });
}

/** Chooses the model and sets the monthly cap. Only the owner (HQ_SITE_BUILDER_OWNER). */
export function saveBuilderSettings(deps: BuilderDeps, actorId: Id | null, input: { readonly model: string; readonly cap: string }): Result<true, "forbidden" | "model-unknown" | CapError> {
  if (!isOwner(deps, actorId)) return err("forbidden");
  const model = modelById(input.model);
  if (!model) return err("model-unknown");
  const cap = parseCap(input.cap);
  if (!cap.ok) return cap;
  return deps.transact(() => {
    const before = deps.settings.get();
    deps.settings.save({ model: model.id, capCents: cap.value }, deps.clock());
    recordActivity(deps, { actorId, action: "builder.settings-changed", recordType: "builder", recordId: SETTINGS_ID, context: { model: model.id, capCents: cap.value, wasModel: before.model, wasCapCents: before.capCents } });
    return ok(true);
  });
}

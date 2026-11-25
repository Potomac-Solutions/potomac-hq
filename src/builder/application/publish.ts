// Going live (decision 0010, section 6, slice 4). Permission: `site.build`.
// The newest version goes to a new private repository under the
// organization, or as a pull request to a client's own repository, never
// straight onto the branch a client's site deploys from. Every later
// publish goes the same way as the first.
import { filesFromJson } from "../domain/files.ts";
import { checkRepoName, commitMessage, pullBranch, pullRequestBody, suggestedRepoName, type PublishInputError } from "../domain/publish.ts";
import { parseRepo, type ReworkError } from "../domain/rework.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { BuilderDeps } from "./builder.ts";
import type { Publish, PublishError } from "./ports.ts";

export type PublishInput = {
  /** "new" or "existing". Ignored once a build has been published: it goes where it went before. */
  readonly target: string;
  readonly repoName: string;
  readonly repo: string;
  readonly branch: string;
};

export type PublishOutcome = {
  readonly publish: Publish;
  /** For a new repository: whether the client's site was set up for editing (decision 0003), or why not. */
  readonly editing: "set-up" | "not-tried" | "failed";
};

export type PublishFailure = "forbidden" | "not-found" | "publishing-not-set-up" | "nothing-to-publish" | "busy-build" | "already-sent" | PublishInputError | ReworkError | PublishError;

const encoder = new TextEncoder();

export async function publishVersion(deps: BuilderDeps, actorId: Id | null, buildId: Id, input: PublishInput): Promise<Result<PublishOutcome, PublishFailure>> {
  if (actorId === null || !authorize(deps, actorId, "site.build").ok) return err("forbidden");
  const build = deps.builds.get(buildId);
  if (!build) return err("not-found");
  const version = deps.builds.latest(build.id);
  if (!version) return err("nothing-to-publish");
  if (deps.builds.requests(build.id).some((one) => one.state === "working")) return err("busy-build");
  const github = deps.publishing;
  if (!github) return err("publishing-not-set-up");
  const previous = deps.publishes.listFor(build.id)[0] ?? null;
  if (previous && previous.version === version.number) return err("already-sent");

  const write = [
    ...Object.entries(filesFromJson(version.filesJson)).map(([path, text]) => ({ path, bytes: encoder.encode(text) })),
    ...deps.images.listFor(build.id).flatMap((one) => {
      const body = deps.images.body(one.id);
      return body ? [{ path: one.path, bytes: body }] : [];
    }),
  ];
  const message = commitMessage(build.name, version.number, version.summary);
  const at = () => deps.clock();
  let publish: Publish;
  let madeRepo = false;

  if (previous && previous.kind !== "pull-request") {
    // Our own repository: straight onto its branch.
    const [owner = "", name = ""] = previous.repo.split("/");
    const made = await github.commit({ owner, name }, { branch: previous.branch, from: null, message, write }, true);
    if (!made.ok) return made;
    publish = { id: deps.newId(), buildId: build.id, version: version.number, kind: "commit", repo: previous.repo, branch: previous.branch, commit: made.value.commit, url: `https://github.com/${previous.repo}/commit/${made.value.commit}`, by: actorId, at: at() };
  } else if (previous || input.target === "existing") {
    // A client's own repository: a branch of its own and a pull request.
    const repo = previous ? parseRepo(previous.repo, previous.branch) : parseRepo(input.repo, input.branch);
    if (!repo.ok) return repo;
    const target = { owner: repo.value.owner, name: repo.value.name };
    let base = repo.value.branch;
    if (!base) {
      const found = await github.defaultBranch(target, false);
      if (!found.ok) return found;
      base = found.value;
    }
    const head = pullBranch(version.number);
    const made = await github.commit(target, { branch: head, from: base, message, write }, false);
    if (!made.ok) return made.error === "repo-changed" ? err("already-sent") : made;
    const pull = await github.pullRequest(target, { head, base, title: `${build.name}: version ${version.number}`, body: pullRequestBody(version.number, version.summary) });
    if (!pull.ok) return pull;
    publish = { id: deps.newId(), buildId: build.id, version: version.number, kind: "pull-request", repo: `${target.owner}/${target.name}`, branch: base, commit: made.value.commit, url: pull.value.url, by: actorId, at: at() };
  } else if (input.target === "new") {
    const name = checkRepoName(input.repoName.trim() || suggestedRepoName(deps.clientFacts(build.organizationId)?.name ?? build.name));
    if (!name.ok) return name;
    const created = await github.createRepo(name.value, `${build.name}: made in the Potomac HQ site builder.`);
    if (!created.ok) return created;
    const repo = { owner: github.organization, name: name.value };
    const made = await github.commit(repo, { branch: created.value.branch, from: null, message, write }, true);
    if (!made.ok) return made;
    madeRepo = true;
    publish = { id: deps.newId(), buildId: build.id, version: version.number, kind: "new-repo", repo: `${repo.owner}/${repo.name}`, branch: created.value.branch, commit: made.value.commit, url: `https://github.com/${repo.owner}/${repo.name}`, by: actorId, at: at() };
  } else {
    return err("target-invalid");
  }

  deps.transact(() => {
    deps.publishes.insert(publish);
    recordActivity(deps, { actorId, action: "build.published", recordType: "build", recordId: build.id, context: { kind: publish.kind, repo: publish.repo, version: publish.version } });
  });

  // A new repository whose site keeps the content file is set up so the client can change it (decision 0003).
  let editing: PublishOutcome["editing"] = "not-tried";
  if (madeRepo && deps.setUpEditing && write.some((one) => one.path === "content/site.json")) {
    const set = await deps.setUpEditing(actorId, build.organizationId, { name: build.name, repo: publish.repo, branch: publish.branch, contentPath: "content/site.json", photoDir: "images" });
    editing = set ? "set-up" : "failed";
  }
  return ok({ publish, editing });
}

// Starting a build from a site that already exists (decision 0010, slice 3).
// Permission: `site.build`. Reading happens before anything is saved, so a
// repository or address that can't be read leaves nothing behind.
import { checkBuildInput, type Build, type BuildError } from "../domain/build.ts";
import { checkSite, filesToJson, totalChars, type SiteFiles } from "../domain/files.ts";
import { imageSize, imageType, type BuildImage } from "../domain/image.ts";
import { FIRST_REWORK_ASK, importedAlt, importedImagePath, parseAddress, parseRepo, planRepo, referenceText, sameSiteLinks, slimPage, staticFiles, type ReworkError, type TreeEntry } from "../domain/rework.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import { askClaude, type AskError, type BuilderDeps } from "./builder.ts";
import type { RepoError } from "./ports.ts";

export type ReworkInput = {
  readonly organizationId: string;
  readonly name: string;
  readonly brief: string;
  /** "repo" or "address". */
  readonly source: string;
  readonly repo: string;
  readonly branch: string;
  readonly address: string;
};

export type ReworkStartError = "forbidden" | "no-such-client" | BuildError | ReworkError | RepoError | "address-private" | "address-unreadable" | "nothing-to-read";

export type ReworkResult = {
  readonly build: Build;
  readonly first: Result<Build, AskError>;
  /** What was read, for the message after: "12 files and 4 pictures". */
  readonly read: { readonly files: number; readonly pictures: number; readonly pages: number; readonly asIs: boolean };
};

type Read = { readonly from: string; readonly files: SiteFiles | null; readonly reference: string; readonly pictures: readonly { readonly path: string; readonly bytes: Uint8Array }[]; readonly pages: number };

const decode = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

async function readRepo(deps: BuilderDeps, repoText: string, branchText: string): Promise<Result<Read, ReworkStartError>> {
  const repo = parseRepo(repoText, branchText);
  if (!repo.ok) return repo;
  if (!deps.repos) return err("github-not-set-up");
  const reader = deps.repos;
  const tree = await reader.tree(repo.value);
  if (!tree.ok) return tree;
  const plan = planRepo(tree.value.files);
  const readAll = async (entries: readonly TreeEntry[]) => {
    const out: { path: string; bytes: Uint8Array }[] = [];
    for (const one of entries) {
      const blob = await reader.blob(repo.value, one.sha);
      if (blob.ok) out.push({ path: one.path, bytes: blob.value });
    }
    return out;
  };
  const texts = (await readAll(plan.files)).map((one) => ({ path: one.path, text: decode(one.bytes) }));
  const pictures = await readAll(plan.pictures);
  const from = `github.com/${repo.value.owner}/${repo.value.name}${repo.value.branch ? ` (${tree.value.branch})` : ""}`;
  if (plan.kind === "static") {
    const files = staticFiles(texts);
    if (checkSite(files).ok && files["index.html"] !== undefined) return ok({ from, files, reference: "", pictures, pages: 0 });
  }
  const reference = referenceText(texts.filter((one) => one.text !== null).map((one) => ({ from: one.path, text: one.text as string })));
  if (!reference && pictures.length === 0) return err("nothing-to-read");
  return ok({ from, files: null, reference, pictures, pages: 0 });
}

/** The home page and up to ten pages it links to on the same site. */
async function readAddress(deps: BuilderDeps, text: string): Promise<Result<Read, ReworkStartError>> {
  const home = parseAddress(text);
  if (!home.ok) return home;
  const first = await deps.fetchPage(home.value.toString());
  if (!first.ok) return err(first.error === "address-private" ? "address-private" : "address-unreadable");
  if (first.value.status < 200 || first.value.status >= 300 || !/<html|<body|<!doctype/i.test(first.value.text)) return err("address-unreadable");
  const pages = [{ from: home.value.toString(), text: slimPage(first.value.text) }];
  for (const url of sameSiteLinks(first.value.text, home.value, 10)) {
    const page = await deps.fetchPage(url.toString());
    if (page.ok && page.value.status >= 200 && page.value.status < 300) pages.push({ from: url.toString(), text: slimPage(page.value.text) });
  }
  return ok({ from: home.value.host + (home.value.pathname === "/" ? "" : home.value.pathname), files: null, reference: referenceText(pages), pictures: [], pages: pages.length });
}

/**
 * Starts a build from an existing site, then asks Claude to rework it. A
 * static repository becomes version 1 as it is; anything else is read as
 * reference. Its pictures keep their paths, so old pages still show them.
 */
export async function startRework(deps: BuilderDeps, actorId: Id | null, input: ReworkInput): Promise<Result<ReworkResult, ReworkStartError>> {
  if (actorId === null || !authorize(deps, actorId, "site.build").ok) return err("forbidden");
  const client = deps.clients().find((one) => one.id === input.organizationId);
  if (!client) return err("no-such-client");
  const checked = checkBuildInput(input);
  if (!checked.ok) return checked;
  const read = input.source === "repo" ? await readRepo(deps, input.repo, input.branch) : input.source === "address" ? await readAddress(deps, input.address) : err<ReworkStartError>("source-invalid");
  if (!read.ok) return read;
  const { files, reference, pictures, from, pages } = read.value;
  const at = deps.clock();
  const build: Build = { id: deps.newId(), organizationId: client.id, name: checked.value.name, brief: checked.value.brief, createdBy: actorId, createdAt: at, referenceFrom: from };
  let kept = 0;
  deps.transact(() => {
    deps.builds.insert(build);
    deps.builds.setReference(build.id, from, reference);
    for (const picture of pictures) {
      const type = imageType(picture.bytes);
      const size = type.ok ? imageSize(picture.bytes, type.value) : null;
      const path = importedImagePath(picture.path);
      if (!type.ok || !size || !path || deps.images.atPath(build.id, path)) continue;
      const image: BuildImage = { id: deps.newId(), buildId: build.id, path, kind: /logo/i.test(path) ? "logo" : "photo", contentType: type.value.contentType, width: size.width, height: size.height, alt: importedAlt(path), bytes: picture.bytes.length, addedBy: actorId, createdAt: at };
      deps.images.insert(image, picture.bytes);
      kept += 1;
    }
    if (files) deps.builds.insertVersion({ buildId: build.id, number: 1, requestId: null, madeBy: actorId, summary: `Imported as it was from ${from}.`, filesJson: filesToJson(files), chars: totalChars(files), createdAt: at });
    recordActivity(deps, { actorId, action: "build.started", recordType: "build", recordId: build.id, context: { client: client.name, reworkedFrom: input.source, files: files ? Object.keys(files).length : 0, pictures: kept } });
  });
  const first = askClaude(deps, actorId, build.id, FIRST_REWORK_ASK);
  return ok({ build, first, read: { files: files ? Object.keys(files).length : reference ? (reference.match(/<source /g) ?? []).length : 0, pictures: kept, pages, asIs: files !== null } });
}

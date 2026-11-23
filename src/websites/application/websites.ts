// A client's website content: the gallery, a notice and reviews, changed by
// the client in the portal or by Potomac in HQ, checked by Potomac, then
// committed to the site's repository so the site rebuilds with it.
//
// Nothing a client does here reaches their site by itself. Their changes
// wait until someone with `site.publish` publishes them.
import { changesBetween, isMove, readContent, sameContent, withNotice, withoutPhoto, withoutReview, withPhoto, withPhotoMoved, withPhotoWords, withReview, writeContent, LIMITS, MAX_PHOTOS, MAX_REVIEWS, type ContentError, type SiteContent } from "../domain/content.ts";
import { cleanSiteAddress, describeLaunch, isOpen, launchBlock, launchFrom, opensFields, previewLink, readLaunch, type Launch, type LaunchError, type LaunchInput } from "../domain/launch.ts";
import { checkPhoto, contentTypeOf, photoFileName, MAX_PHOTO_BYTES, type PhotoError } from "../domain/photo.ts";
import { discarded, publishedAs, repoPathFor, sentBack, siteSetup, srcFor, submitted, withDraft, working, type ContentSite, type SetupError, type SetupInput } from "../domain/site.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { ContentSiteStore, PhotoStore, RepoError, SitePublisher, StoredPhoto } from "./ports.ts";

export type { ContentSite, Repo } from "../domain/site.ts";

export type WebsitesDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly sites: ContentSiteStore;
  readonly photos: PhotoStore;
  readonly clientName: (organizationId: Id) => string | null;
  readonly formatWhen: (instant: string) => string;
  /** Reads and commits to GitHub. Null when HQ has no token for it. */
  readonly publisher: SitePublisher | null;
  /** The business's time zone: an opening time is a day and a time there. */
  readonly timeZone: string;
  /** SHA-256 of a text, as lower-case hex. */
  readonly digest: (text: string) => string;
  /** Random bytes, for a preview key. */
  readonly random: (length: number) => Uint8Array;
};

/** The site's content file as it is written to its repository: the content, and the site's status. */
function fileFor(deps: WebsitesDeps, site: Pick<ContentSite, "launch" | "previewKey">, content: SiteContent): Uint8Array {
  return new TextEncoder().encode(writeContent(content, launchBlock(site.launch, deps.timeZone, site.previewKey ? deps.digest(site.previewKey) : null)));
}

/** A client signed in to the portal. The same shape as the portal's session. */
export type ClientEditor = { readonly clientUserId: Id; readonly organizationId: Id; readonly name: string };

/**
 * Who is making a change. A client changes only their own organization's
 * site, taken from their session and from nothing they send. One of
 * Potomac's people needs `site.publish`.
 */
export type Editor = { readonly kind: "client"; readonly session: ClientEditor | null } | { readonly kind: "staff"; readonly actorId: Id | null };

type Refused = "forbidden" | "not-found";
const may = (deps: WebsitesDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

/** The site an editor may change. A client's is their own; `siteId` is for Potomac's people. */
function siteFor(deps: WebsitesDeps, editor: Editor, siteId: Id | null): Result<ContentSite, Refused> {
  if (editor.kind === "client") {
    const site = editor.session ? deps.sites.forOrganization(editor.session.organizationId) : null;
    // Signed out, or no site: the same answer, so nothing is learned by asking.
    return site && (siteId === null || siteId === site.id) ? ok(site) : err("not-found");
  }
  if (!may(deps, editor.actorId, "site.publish")) return err("forbidden");
  const site = siteId ? deps.sites.get(siteId) : null;
  return site ? ok(site) : err("not-found");
}

const by = (editor: Editor) => (editor.kind === "client" ? "client" : "staff");

/** Writes the event for a change. A client's carries who they are, so Potomac is told. */
function note(deps: WebsitesDeps, editor: Editor, action: string, site: ContentSite, context: Record<string, string | number | boolean> = {}): void {
  recordActivity(deps, {
    actorId: editor.kind === "staff" ? editor.actorId : null,
    action,
    recordType: "content-site",
    recordId: site.id,
    context: { organizationId: site.organizationId, ...(editor.kind === "client" && editor.session ? { clientUserId: editor.session.clientUserId, by: "client" } : {}), ...context },
  });
}

/** Makes one change to a site's waiting content, saves it and writes its event. */
function change(deps: WebsitesDeps, editor: Editor, siteId: Id | null, action: string, make: (content: SiteContent, site: ContentSite) => Result<{ content: SiteContent; context?: Record<string, string | number | boolean> }, ContentError | PhotoError>): Result<ContentSite, Refused | ContentError | PhotoError> {
  return deps.transact(() => {
    const site = siteFor(deps, editor, siteId);
    if (!site.ok) return site;
    const made = make(working(site.value), site.value);
    if (!made.ok) return made;
    const next = withDraft(site.value, made.value.content, by(editor));
    deps.sites.save(next, deps.clock());
    dropUnused(deps, next);
    note(deps, editor, action, next, made.value.context);
    return ok(next);
  });
}

// ── Setting a site up, and reading it again ──────────────────────────────

type ReadError = "github-not-set-up" | RepoError | "content-invalid" | "photo-unreadable";

/** Reads a site's content file and every photo it names. */
async function readSite(deps: WebsitesDeps, setup: Pick<ContentSite, "repo" | "contentPath" | "photoDir">, siteId: Id | null): Promise<Result<{ content: SiteContent; launch: Launch; photos: { id: Id; path: string; body: Uint8Array }[] }, ReadError>> {
  if (!deps.publisher) return err("github-not-set-up");
  const file = await deps.publisher.read(setup.repo, setup.contentPath);
  if (!file.ok) return file;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file.value);
  } catch {
    return err("content-invalid");
  }
  const read = readContent(text, deps.newId);
  if (!read.ok) return read;
  // A site started as a copy of another carries that site's photo ids. An id belongs to one site: give those new ones.
  const taken = (id: Id) => {
    const owner = deps.photos.get(id)?.siteId;
    return owner !== undefined && owner !== siteId;
  };
  const content = { ok: true as const, value: { ...read.value, gallery: read.value.gallery.map((photo) => (taken(photo.id) ? { ...photo, id: deps.newId() } : photo)) } };
  const photos: { id: Id; path: string; body: Uint8Array }[] = [];
  for (const photo of content.value.gallery) {
    const path = repoPathFor(setup.photoDir, photo.src);
    const body = await deps.publisher.read(setup.repo, path);
    if (!body.ok) return err(body.error === "repo-missing" ? "photo-unreadable" : body.error);
    photos.push({ id: photo.id, path, body: body.value });
  }
  return ok({ content: content.value, launch: readLaunch(text), photos });
}

/**
 * Sets a client's site up for editing: checks where it lives, then reads
 * its content file and photos from the repository. Permission:
 * `site.publish`. A client has one site.
 */
export async function setUpSite(deps: WebsitesDeps, actorId: Id | null, organizationId: Id, input: SetupInput): Promise<Result<ContentSite, Refused | SetupError | ReadError | "already-set-up" | "repo-in-use">> {
  if (!may(deps, actorId, "site.publish")) return err("forbidden");
  if (deps.clientName(organizationId) === null) return err("not-found");
  if (deps.sites.forOrganization(organizationId)) return err("already-set-up");
  const setup = siteSetup(input);
  if (!setup.ok) return setup;
  const sameFile = (site: ContentSite) => site.repo.owner.toLowerCase() === setup.value.repo.owner.toLowerCase() && site.repo.name.toLowerCase() === setup.value.repo.name.toLowerCase() && site.contentPath === setup.value.contentPath;
  if (deps.sites.list().some(sameFile)) return err("repo-in-use");
  const read = await readSite(deps, setup.value, null);
  if (!read.ok) return read;
  return deps.transact(() => {
    if (deps.sites.forOrganization(organizationId)) return err("already-set-up");
    const at = deps.clock();
    const site: ContentSite = { id: deps.newId(), organizationId, ...setup.value, published: read.value.content, publishedAt: null, publishedCommit: null, draft: null, draftState: "none", submittedAt: null, submittedBy: null, note: "", launch: read.value.launch, previewKey: null };
    deps.sites.insert(site, at);
    for (const photo of read.value.photos) deps.photos.put({ id: photo.id, siteId: site.id, path: photo.path, contentType: contentTypeOf(photo.path), inRepo: true }, photo.body, at);
    recordActivity(deps, { actorId, action: "site-content.set-up", recordType: "content-site", recordId: site.id, context: { organizationId, repo: `${site.repo.owner}/${site.repo.name}`, branch: site.repo.branch, photos: read.value.photos.length } });
    return ok(site);
  });
}

/**
 * Reads the site from its repository again, after someone changed it there
 * by hand. Refused while changes are waiting: they were made against the
 * old content. Permission: `site.publish`.
 */
export async function readSiteAgain(deps: WebsitesDeps, actorId: Id | null, siteId: Id): Promise<Result<ContentSite, Refused | ReadError | "changes-waiting">> {
  const found = siteFor(deps, { kind: "staff", actorId }, siteId);
  if (!found.ok) return found;
  if (found.value.draft) return err("changes-waiting");
  const read = await readSite(deps, found.value, siteId);
  if (!read.ok) return read;
  return deps.transact(() => {
    const site = deps.sites.get(siteId);
    if (!site) return err("not-found");
    if (site.draft) return err("changes-waiting");
    const at = deps.clock();
    const next: ContentSite = { ...site, published: read.value.content, launch: read.value.launch };
    deps.sites.save(next, at);
    deps.photos.removeAllFor(site.id);
    for (const photo of read.value.photos) deps.photos.put({ id: photo.id, siteId: site.id, path: photo.path, contentType: contentTypeOf(photo.path), inRepo: true }, photo.body, at);
    recordActivity(deps, { actorId, action: "site-content.read-again", recordType: "content-site", recordId: site.id, context: { organizationId: site.organizationId, photos: read.value.photos.length } });
    return ok(next);
  });
}

// ── Changes ──────────────────────────────────────────────────────────────

export type NewPhoto = { readonly title: string; readonly alt: string; readonly caption?: string | null; readonly bytes: Uint8Array | null };

export function addPhoto(deps: WebsitesDeps, editor: Editor, siteId: Id | null, input: NewPhoto) {
  return change(deps, editor, siteId, "site-content.photo-added", (content, site) => {
    const kind = checkPhoto(input.bytes);
    if (!kind.ok || !input.bytes) return kind.ok ? err("photo-missing") : kind;
    const id = deps.newId();
    const fileName = photoFileName(id, kind.value);
    const next = withPhoto(content, { id, src: srcFor(site.photoDir, fileName) }, input);
    if (!next.ok) return next;
    deps.photos.put({ id, siteId: site.id, path: `${site.photoDir}/${fileName}`, contentType: kind.value.contentType, inRepo: false }, input.bytes, deps.clock());
    return ok({ content: next.value, context: { photoId: id, sizeBytes: input.bytes.length } });
  });
}

/** Runs a change on the site a photo belongs to. A photo that is not theirs is "not found". */
function onPhoto(deps: WebsitesDeps, editor: Editor, photoId: Id, action: string, make: (content: SiteContent) => Result<SiteContent, ContentError>): Result<ContentSite, Refused | ContentError | PhotoError> {
  if (editor.kind === "staff" && !may(deps, editor.actorId, "site.publish")) return err("forbidden");
  const photo = deps.photos.get(photoId);
  if (!photo) return err("not-found");
  return change(deps, editor, photo.siteId, action, (content) => {
    const next = make(content);
    return next.ok ? ok({ content: next.value, context: { photoId } }) : next;
  });
}

export const editPhoto = (deps: WebsitesDeps, editor: Editor, photoId: Id, input: { readonly title: string; readonly alt: string; readonly caption?: string | null }) => onPhoto(deps, editor, photoId, "site-content.photo-changed", (content) => withPhotoWords(content, photoId, input));
export const removePhoto = (deps: WebsitesDeps, editor: Editor, photoId: Id) => onPhoto(deps, editor, photoId, "site-content.photo-removed", (content) => withoutPhoto(content, photoId));
export const movePhoto = (deps: WebsitesDeps, editor: Editor, photoId: Id, move: string) => onPhoto(deps, editor, photoId, "site-content.photos-reordered", (content) => (isMove(move) ? withPhotoMoved(content, photoId, move) : err("unchanged")));

export function setNotice(deps: WebsitesDeps, editor: Editor, siteId: Id | null, typed: string) {
  return change(deps, editor, siteId, "site-content.notice-changed", (content) => {
    const next = withNotice(content, typed);
    return next.ok ? ok({ content: next.value, context: { set: next.value.notice !== "" } }) : next;
  });
}

export function addReview(deps: WebsitesDeps, editor: Editor, siteId: Id | null, input: { readonly quote: string; readonly by: string }) {
  return change(deps, editor, siteId, "site-content.review-added", (content) => {
    const next = withReview(content, input);
    return next.ok ? ok({ content: next.value }) : next;
  });
}

export function removeReview(deps: WebsitesDeps, editor: Editor, siteId: Id | null, index: number) {
  return change(deps, editor, siteId, "site-content.review-removed", (content) => {
    const next = withoutReview(content, index);
    return next.ok ? ok({ content: next.value }) : next;
  });
}

/** Photos uploaded for changes that are no longer waiting: not in the repository, and not in what is. */
function dropUnused(deps: WebsitesDeps, site: ContentSite): void {
  const used = new Set([...site.published.gallery, ...(site.draft?.gallery ?? [])].map((photo) => photo.id));
  for (const photo of deps.photos.listFor(site.id)) if (!photo.inRepo && !used.has(photo.id)) deps.photos.remove(photo.id);
}

/** Throws the waiting changes away. What is on the site stays as it is. */
export function discardChanges(deps: WebsitesDeps, editor: Editor, siteId: Id | null): Result<ContentSite, Refused | "nothing-waiting"> {
  return deps.transact(() => {
    const site = siteFor(deps, editor, siteId);
    if (!site.ok) return site;
    const next = discarded(site.value);
    if (!next.ok) return next;
    deps.sites.save(next.value, deps.clock());
    dropUnused(deps, next.value);
    note(deps, editor, "site-content.changes-discarded", next.value);
    return ok(next.value);
  });
}

/** A client sends their changes to Potomac to check and put on the site. */
export function submitChanges(deps: WebsitesDeps, session: ClientEditor | null): Result<ContentSite, Refused | "nothing-to-send" | "already-sent"> {
  const editor: Editor = { kind: "client", session };
  return deps.transact(() => {
    const site = siteFor(deps, editor, null);
    if (!site.ok || !session) return err("not-found");
    const next = submitted(site.value, session.name, deps.clock());
    if (!next.ok) return next;
    deps.sites.save(next.value, deps.clock());
    note(deps, editor, "site-content.submitted", next.value, { changes: changesBetween(next.value.published, working(next.value)).length });
    return ok(next.value);
  });
}

/** Potomac sends a client's changes back with a note saying what to fix. Permission: `site.publish`. */
export function sendChangesBack(deps: WebsitesDeps, actorId: Id | null, siteId: Id, typed: string): Result<ContentSite, Refused | "not-sent" | "note-missing" | "note-too-long"> {
  const editor: Editor = { kind: "staff", actorId };
  return deps.transact(() => {
    const site = siteFor(deps, editor, siteId);
    if (!site.ok) return site;
    const next = sentBack(site.value, typed);
    if (!next.ok) return next;
    deps.sites.save(next.value, deps.clock());
    note(deps, editor, "site-content.sent-back", next.value);
    return ok(next.value);
  });
}

// One publish at a time for a site: a second would commit against a branch the first is about to move.
const publishing = new Set<string>();

/**
 * Puts the waiting changes on the site: one commit to its repository with
 * the content file, any new photos, and the removal of photos no longer
 * used. The site's host rebuilds from that commit. Permission:
 * `site.publish`.
 */
export async function publishChanges(deps: WebsitesDeps, actorId: Id | null, siteId: Id): Promise<Result<ContentSite, Refused | "nothing-waiting" | "github-not-set-up" | "busy" | "photo-lost" | RepoError>> {
  const found = siteFor(deps, { kind: "staff", actorId }, siteId);
  if (!found.ok) return found;
  const site = found.value;
  if (!site.draft) return err("nothing-waiting");
  if (!deps.publisher) return err("github-not-set-up");
  if (publishing.has(site.id)) return err("busy");
  publishing.add(site.id);
  try {
    const draft = site.draft;
    const stored = new Map(deps.photos.listFor(site.id).map((photo) => [photo.id, photo]));
    const write: { path: string; bytes: Uint8Array }[] = [{ path: site.contentPath, bytes: fileFor(deps, site, draft) }];
    const added: StoredPhoto[] = [];
    for (const photo of draft.gallery) {
      const one = stored.get(photo.id);
      const body = one && !one.inRepo ? deps.photos.body(one.id) : null;
      if (!one || (!one.inRepo && !body)) return err("photo-lost");
      if (body) {
        write.push({ path: one.path, bytes: body });
        added.push(one);
      }
    }
    const keep = new Set(draft.gallery.map((photo) => photo.id));
    const gone = [...stored.values()].filter((photo) => photo.inRepo && !keep.has(photo.id));
    const changes = changesBetween(site.published, draft);
    const message = `Update site content\n\n${changes.map((one) => `- ${one}`).join("\n")}\n\nPublished from Potomac HQ.`;
    const committed = await deps.publisher.commit(site.repo, { message, write, remove: gone.map((photo) => photo.path) });
    if (!committed.ok) return committed;
    return deps.transact(() => {
      // The commit is made. Whatever else changed while it was, record what is now on the site.
      const at = deps.clock();
      const current = deps.sites.get(site.id) ?? site;
      const live = publishedAs({ ...current, draft }, committed.value.commit, at);
      // A change made while the commit was on its way is not on the site: it stays waiting.
      const next = current.draft && !sameContent(current.draft, draft) ? withDraft(live, current.draft, "client") : live;
      deps.sites.save(next, at);
      for (const photo of added) deps.photos.markInRepo(photo.id);
      for (const photo of gone) deps.photos.remove(photo.id);
      dropUnused(deps, next);
      recordActivity(deps, { actorId, action: "site-content.published", recordType: "content-site", recordId: site.id, context: { organizationId: site.organizationId, commit: committed.value.commit, changes: changes.length, photosAdded: added.length, photosRemoved: gone.length } });
      return ok(next);
    });
  } finally {
    publishing.delete(site.id);
  }
}

// ── Whether the site is open ─────────────────────────────────────────────

const sameLaunch = (a: Launch, b: Launch) => a.mode === b.mode && a.opensAt === b.opensAt && a.message === b.message;
const newPreviewKey = (deps: WebsitesDeps) => [...deps.random(16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Commits the site's content file as it is on the site, with a new status block. */
async function commitStatus(deps: WebsitesDeps, site: ContentSite, next: Pick<ContentSite, "launch" | "previewKey">, message: string): Promise<Result<{ readonly commit: string }, "github-not-set-up" | "busy" | RepoError>> {
  if (!deps.publisher) return err("github-not-set-up");
  if (publishing.has(site.id)) return err("busy");
  publishing.add(site.id);
  try {
    return await deps.publisher.commit(site.repo, { message: `${message}\n\nSet from Potomac HQ.`, write: [{ path: site.contentPath, bytes: fileFor(deps, next, site.published) }], remove: [] });
  } finally {
    publishing.delete(site.id);
  }
}

/**
 * Opens the site, or puts "coming soon" or "closed for maintenance" in
 * front of it, with a time it opens by itself. Takes effect at once: one
 * commit to the site's repository with the status and nothing else, so
 * changes still waiting to be checked stay waiting. A client does this for
 * their own site; Potomac's people need `site.publish`.
 *
 * The first time a site is closed it gets a preview key. Only the key's
 * hash goes in the site's file.
 */
export async function setSiteStatus(deps: WebsitesDeps, editor: Editor, siteId: Id | null, input: LaunchInput): Promise<Result<ContentSite, Refused | LaunchError | "unchanged" | "github-not-set-up" | "busy" | RepoError>> {
  const found = siteFor(deps, editor, siteId);
  if (!found.ok) return found;
  const site = found.value;
  const launch = launchFrom(input, deps.timeZone, deps.clock());
  if (!launch.ok) return launch;
  if (sameLaunch(launch.value, site.launch)) return err("unchanged");
  const previewKey = site.previewKey ?? (launch.value.mode === "live" ? null : newPreviewKey(deps));
  const words = launch.value.mode === "live" ? "open to everyone" : `${launch.value.mode === "coming-soon" ? "coming soon" : "closed for maintenance"}${launch.value.opensAt ? `, opens ${launch.value.opensAt}` : ""}`;
  const committed = await commitStatus(deps, site, { launch: launch.value, previewKey }, `Site status: ${words}`);
  if (!committed.ok) return committed;
  return deps.transact(() => {
    const next: ContentSite = { ...(deps.sites.get(site.id) ?? site), launch: launch.value, previewKey };
    deps.sites.save(next, deps.clock());
    note(deps, editor, "site-content.status-changed", next, { mode: launch.value.mode, ...(launch.value.opensAt ? { opensAt: launch.value.opensAt } : {}), commit: committed.value.commit });
    return ok(next);
  });
}

/**
 * Makes a new preview link, so the old one stops working: for when it has
 * been passed on further than meant. While the site is closed this is a
 * commit, because the site checks the link against the hash in its file.
 */
export async function newPreviewLink(deps: WebsitesDeps, editor: Editor, siteId: Id | null): Promise<Result<ContentSite, Refused | "github-not-set-up" | "busy" | RepoError>> {
  const found = siteFor(deps, editor, siteId);
  if (!found.ok) return found;
  const site = found.value;
  const previewKey = newPreviewKey(deps);
  if (site.launch.mode !== "live") {
    const committed = await commitStatus(deps, site, { launch: site.launch, previewKey }, "Site status: new preview link");
    if (!committed.ok) return committed;
  }
  return deps.transact(() => {
    const next: ContentSite = { ...(deps.sites.get(site.id) ?? site), previewKey };
    deps.sites.save(next, deps.clock());
    note(deps, editor, "site-content.preview-link-renewed", next);
    return ok(next);
  });
}

/** Sets the site's own address, which its preview link is made from. Permission: `site.publish`. */
export function setSiteAddress(deps: WebsitesDeps, actorId: Id | null, siteId: Id, typed: string): Result<ContentSite, Refused | "address-invalid" | "unchanged"> {
  const editor: Editor = { kind: "staff", actorId };
  return deps.transact(() => {
    const site = siteFor(deps, editor, siteId);
    if (!site.ok) return site;
    const address = cleanSiteAddress(typed);
    if (!address.ok) return address;
    if (address.value === site.value.siteUrl) return err("unchanged");
    const next: ContentSite = { ...site.value, siteUrl: address.value };
    deps.sites.save(next, deps.clock());
    note(deps, editor, "site-content.address-changed", next, { siteUrl: address.value });
    return ok(next);
  });
}

// ── What people are shown ────────────────────────────────────────────────

export type StatusView = {
  /** What the form should have chosen: "live" once the site has opened by itself. */
  readonly mode: string;
  /** True when visitors see the site itself. */
  readonly open: boolean;
  readonly label: string;
  readonly summary: string;
  readonly opensOn: string;
  readonly opensTime: string;
  readonly message: string;
  /** "Eastern Time": where the opening time is. */
  readonly zone: string;
  /** The earliest day an opening time can be. */
  readonly today: string;
  readonly siteUrl: string;
  /** The link that shows the real site while it is closed. Empty when the site's address isn't known or it was never closed. */
  readonly previewUrl: string;
  /** True once the site has a preview key, whether or not its address is known. */
  readonly hasPreviewKey: boolean;
};

function statusView(deps: WebsitesDeps, site: ContentSite): StatusView {
  const now = deps.clock();
  const open = isOpen(site.launch, now);
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: deps.timeZone, timeZoneName: "longGeneric" }).formatToParts(new Date(now)).find((part) => part.type === "timeZoneName")?.value ?? deps.timeZone;
  return {
    mode: open ? "live" : site.launch.mode,
    open,
    label: open ? "Open" : site.launch.mode === "coming-soon" ? "Coming soon" : "Closed for maintenance",
    summary: describeLaunch(site.launch, deps.timeZone, now),
    ...(open ? { opensOn: "", opensTime: "", message: "" } : { ...opensFields(site.launch, deps.timeZone), message: site.launch.message }),
    zone,
    today: Temporal.Instant.from(now).toZonedDateTimeISO(deps.timeZone).toPlainDate().toString(),
    siteUrl: site.siteUrl,
    previewUrl: site.siteUrl && site.previewKey ? previewLink(site.siteUrl, site.previewKey) : "",
    hasPreviewKey: site.previewKey !== null,
  };
}

export type PhotoLine = { readonly id: string; readonly title: string; readonly alt: string; readonly caption: string; readonly isNew: boolean; readonly first: boolean; readonly last: boolean; readonly position: number };

export type EditorView = {
  readonly siteId: string;
  readonly name: string;
  readonly photos: readonly PhotoLine[];
  readonly canAddPhoto: boolean;
  readonly canRemovePhoto: boolean;
  readonly notice: string;
  readonly reviews: readonly { readonly index: number; readonly quote: string; readonly by: string }[];
  readonly canAddReview: boolean;
  /** What is waiting, as sentences. Empty when the page shows what is on the site. */
  readonly changes: readonly string[];
  readonly state: "none" | "editing" | "submitted";
  /** "Sent by Dana Groves, Nov 23, 2026, 3:40 PM", when sent. */
  readonly sent: string;
  /** What Potomac wrote when sending changes back. */
  readonly note: string;
  readonly limits: typeof LIMITS;
  readonly photoRule: string;
  /** Whether the site is open to everyone. */
  readonly status: StatusView;
};

function editorView(deps: WebsitesDeps, site: ContentSite): EditorView {
  const content = working(site);
  const live = new Set(site.published.gallery.map((photo) => photo.id));
  return {
    siteId: site.id,
    name: site.name,
    photos: content.gallery.map((photo, index) => ({ id: photo.id, title: photo.title, alt: photo.alt, caption: photo.caption, isNew: !live.has(photo.id), first: index === 0, last: index === content.gallery.length - 1, position: index + 1 })),
    canAddPhoto: content.gallery.length < MAX_PHOTOS,
    canRemovePhoto: content.gallery.length > 1,
    notice: content.notice,
    reviews: content.reviews.map((review, index) => ({ index, quote: review.quote, by: review.by })),
    canAddReview: content.reviews.length < MAX_REVIEWS,
    changes: site.draft ? changesBetween(site.published, site.draft) : [],
    state: site.draftState,
    sent: site.draftState === "submitted" && site.submittedAt ? `Sent by ${site.submittedBy ?? "the client"}, ${deps.formatWhen(site.submittedAt)}` : "",
    note: site.note,
    limits: LIMITS,
    status: statusView(deps, site),
    photoRule: `A JPEG, PNG or WebP photo. Up to ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} MB after HQ shrinks it for the web.`,
  };
}

/** A client's own site, to change. Null when they have none set up, or are signed out. */
export function portalWebsite(deps: WebsitesDeps, session: ClientEditor | null): EditorView | null {
  const site = siteFor(deps, { kind: "client", session }, null);
  return site.ok ? editorView(deps, site.value) : null;
}

export type StaffSiteView = EditorView & { readonly organizationId: string; readonly clientName: string; readonly repo: string; readonly branch: string; readonly contentPath: string; readonly photoDir: string; readonly lastPublished: string; readonly canPublish: boolean; readonly githubSetUp: boolean };

/** A site as Potomac's people see it: the same editor, with where it lives and what is waiting. Permission: `site.publish`. */
export function staffWebsite(deps: WebsitesDeps, actorId: Id | null, siteId: Id): Result<StaffSiteView, Refused> {
  const site = siteFor(deps, { kind: "staff", actorId }, siteId);
  if (!site.ok) return site;
  const s = site.value;
  return ok({
    ...editorView(deps, s),
    organizationId: s.organizationId,
    clientName: deps.clientName(s.organizationId) ?? "A removed client",
    repo: `${s.repo.owner}/${s.repo.name}`,
    branch: s.repo.branch,
    contentPath: s.contentPath,
    photoDir: s.photoDir,
    lastPublished: s.publishedAt ? deps.formatWhen(s.publishedAt) : "",
    canPublish: s.draft !== null,
    githubSetUp: deps.publisher !== null,
  });
}

export type SiteLine = { readonly id: string; readonly organizationId: string; readonly name: string; readonly clientName: string; readonly repo: string; readonly state: string; readonly stateLabel: string; readonly detail: string };

const lineOf = (deps: WebsitesDeps, site: ContentSite): SiteLine => ({
  id: site.id,
  organizationId: site.organizationId,
  name: site.name,
  clientName: deps.clientName(site.organizationId) ?? "A removed client",
  repo: `${site.repo.owner}/${site.repo.name}`,
  state: site.draftState,
  stateLabel: site.draftState === "submitted" ? "Changes to check" : site.draftState === "editing" ? "Being changed" : "Up to date",
  detail: site.draftState === "submitted" && site.submittedAt ? `Sent by ${site.submittedBy ?? "the client"}, ${deps.formatWhen(site.submittedAt)}` : site.publishedAt ? `Last published ${deps.formatWhen(site.publishedAt)}` : "Nothing published from HQ yet",
});

export type WebsitesView = { readonly sites: readonly SiteLine[]; readonly waiting: number; readonly githubSetUp: boolean };

/** Every site set up for editing, those with changes to check first. Seen with `client.view`. */
export function allWebsites(deps: WebsitesDeps, actorId: Id | null): Result<WebsitesView, "forbidden"> {
  if (!may(deps, actorId, "client.view")) return err("forbidden");
  const sites = deps.sites.list().map((site) => lineOf(deps, site));
  return ok({ sites, waiting: sites.filter((one) => one.state === "submitted").length, githubSetUp: deps.publisher !== null });
}

export type ClientWebsiteView = { readonly site: SiteLine | null; readonly canSetUp: boolean; readonly canOpen: boolean; readonly githubSetUp: boolean; readonly defaults: { readonly branch: string; readonly contentPath: string; readonly photoDir: string } };

/** A client's site, for their page in HQ. Null when this person may not see clients. */
export function clientWebsite(deps: WebsitesDeps, actorId: Id | null, organizationId: Id): ClientWebsiteView | null {
  if (!may(deps, actorId, "client.view")) return null;
  const site = deps.sites.forOrganization(organizationId);
  const publish = may(deps, actorId, "site.publish");
  return { site: site ? lineOf(deps, site) : null, canSetUp: publish && !site, canOpen: publish, githubSetUp: deps.publisher !== null, defaults: { branch: "main", contentPath: "src/content/site.json", photoDir: "public/gallery" } };
}

/** A photo's bytes, to show it in HQ or the portal. A photo that is not theirs is "not found". */
export function photoFor(deps: WebsitesDeps, editor: Editor, photoId: Id): Result<{ readonly contentType: string; readonly body: Uint8Array }, "not-found"> {
  const photo = deps.photos.get(photoId);
  if (!photo || !siteFor(deps, editor, photo.siteId).ok) return err("not-found");
  const body = deps.photos.body(photoId);
  return body ? ok({ contentType: photo.contentType, body }) : err("not-found");
}

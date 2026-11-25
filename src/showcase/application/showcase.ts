// Reviews and case studies (decision 0013, section 6). Potomac asks a client
// for a review; the client writes it from the emailed link or in the portal,
// and says whether it may be shown. Someone with `review.manage` publishes
// it, or keeps it back, and writes each client's case study with its
// screenshots. The website reads only what is published.
import { caseStudyFields, checkShot, MAX_SHOTS, REQUEST_DAYS, REVIEW_SOURCE_LABELS, REVIEW_SOURCES, reviewFields, shotAlt, stars, type CaseStudy, type CaseStudyError, type Review, type ReviewError, type ShotError } from "../domain/showcase.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { CaseStudyStore, RequestStore, ReviewStore, ReviewTokens } from "./ports.ts";

export type ShowcaseDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly reviews: ReviewStore;
  readonly requests: RequestStore;
  readonly studies: CaseStudyStore;
  readonly tokens: ReviewTokens;
  readonly formatWhen: (instant: string) => string;
  readonly clientName: (organizationId: Id) => string | null;
  /** Who to ask at a client: their primary contact with an email. */
  readonly contactFor: (organizationId: Id) => { readonly name: string; readonly email: string } | null;
};

type Refused = "forbidden" | "not-found";
const allowed = (deps: ShowcaseDeps, actorId: Id | null): actorId is Id => actorId !== null && authorize(deps, actorId, "review.manage").ok;
const tokenShape = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);

/** Whether someone may ask for reviews and publish them. */
export const mayManageShowcase = (deps: ShowcaseDeps, actorId: Id | null): boolean => allowed(deps, actorId);

// ---------- Asking, and writing ----------

/** Makes a link for a client's contact to write a review. Emailing it is the route's job. */
export function askForReview(deps: ShowcaseDeps, actorId: Id | null, organizationId: Id): Result<{ readonly to: { readonly name: string; readonly email: string }; readonly token: string }, Refused | "no-email"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    if (deps.clientName(organizationId) === null) return err("not-found");
    const to = deps.contactFor(organizationId);
    if (!to) return err("no-email");
    const at = deps.clock();
    const token = deps.tokens.newToken();
    const id = deps.newId();
    deps.requests.insert({ id, organizationId, email: to.email, tokenHash: deps.tokens.hash(token), expiresAt: Temporal.Instant.from(at).add({ hours: 24 * REQUEST_DAYS }).toString(), createdBy: actorId }, at);
    recordActivity(deps, { actorId, action: "review.asked", recordType: "client-organization", recordId: organizationId, context: { requestId: id } });
    return ok({ to, token });
  });
}

/** The client a review link is for, when it still works. */
export function reviewLink(deps: ShowcaseDeps, token: string): { readonly clientName: string } | null {
  if (!tokenShape(token)) return null;
  const found = deps.requests.byTokenHash(deps.tokens.hash(token));
  if (!found || found.usedAt || Temporal.Instant.compare(found.expiresAt, deps.clock()) <= 0) return null;
  return { clientName: deps.clientName(found.organizationId) ?? "" };
}

export type WriteInput = { readonly rating: string; readonly text: string; readonly displayName: string; readonly town?: string | null; readonly mayPublish: boolean };

function writeReview(deps: ShowcaseDeps, organizationId: Id, input: WriteInput, requestId: Id | null, by: { readonly clientUserId: Id } | null): Result<Review, ReviewError> {
  const fields = reviewFields({ ...input, source: "client" });
  if (!fields.ok) return fields;
  const at = deps.clock();
  const review: Review = { id: deps.newId(), organizationId, ...fields.value, mayPublish: input.mayPublish, status: "waiting", createdAt: at };
  deps.reviews.insert(review, requestId, at);
  recordActivity(deps, { actorId: null, action: "review.written", recordType: "review", recordId: review.id, context: { organizationId, rating: review.rating, mayPublish: review.mayPublish, ...(by ? { clientUserId: by.clientUserId, by: "client" } : { by: "link" }) } });
  return ok(review);
}

/** The client writes their review from the emailed link. The link works once. */
export function writeReviewByLink(deps: ShowcaseDeps, token: string, input: WriteInput): Result<Review, ReviewError | "invalid-link"> {
  if (!tokenShape(token)) return err("invalid-link");
  return deps.transact(() => {
    const found = deps.requests.byTokenHash(deps.tokens.hash(token));
    if (!found || found.usedAt || Temporal.Instant.compare(found.expiresAt, deps.clock()) <= 0) return err("invalid-link");
    const made = writeReview(deps, found.organizationId, input, found.id, null);
    if (made.ok) deps.requests.markUsed(found.id, deps.clock());
    return made;
  });
}

/** Signed in to the portal, a client writes one review. */
export function writeReviewInPortal(deps: ShowcaseDeps, session: { readonly clientUserId: Id; readonly organizationId: Id } | null, input: WriteInput): Result<Review, ReviewError | "not-found" | "already-written"> {
  if (!session) return err("not-found");
  return deps.transact(() => {
    if (deps.reviews.hasClientReview(session.organizationId)) return err("already-written");
    return writeReview(deps, session.organizationId, input, null, { clientUserId: session.clientUserId });
  });
}

/** Whether the signed-in client may still write a review. */
export const mayWriteReview = (deps: ShowcaseDeps, organizationId: Id | null): boolean => organizationId !== null && !deps.reviews.hasClientReview(organizationId);

// ---------- Potomac's side ----------

/** A review given another way (on the phone, on Google), typed in. It may be shown: Potomac asked first. */
export function addReview(deps: ShowcaseDeps, actorId: Id | null, organizationId: Id, input: { readonly rating: string; readonly text: string; readonly displayName: string; readonly town?: string | null; readonly source: string }): Result<Review, Refused | ReviewError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const fields = reviewFields(input);
  if (!fields.ok) return fields;
  return deps.transact(() => {
    if (deps.clientName(organizationId) === null) return err("not-found");
    const at = deps.clock();
    const review: Review = { id: deps.newId(), organizationId, ...fields.value, mayPublish: true, status: "waiting", createdAt: at };
    deps.reviews.insert(review, null, at);
    recordActivity(deps, { actorId, action: "review.added", recordType: "review", recordId: review.id, context: { organizationId, source: review.source } });
    return ok(review);
  });
}

/** Publishes a review, or takes it down. One the writer didn't say may be shown is never published. */
export function setReviewShown(deps: ShowcaseDeps, actorId: Id | null, id: Id, shown: boolean): Result<Review, Refused | "not-allowed-to-show"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const found = deps.reviews.get(id);
    if (!found) return err("not-found");
    if (shown && !found.mayPublish) return err("not-allowed-to-show");
    const status = shown ? "published" : "hidden";
    deps.reviews.setStatus(id, status, deps.clock());
    recordActivity(deps, { actorId, action: shown ? "review.published" : "review.hidden", recordType: "review", recordId: id, context: { organizationId: found.organizationId } });
    return ok({ ...found, status });
  });
}

export type ReviewLine = { readonly id: string; readonly clientId: string; readonly clientName: string; readonly stars: string; readonly rating: number; readonly text: string; readonly who: string; readonly source: string; readonly status: Review["status"]; readonly mayPublish: boolean; readonly when: string };
export type CaseStudyLine = { readonly id: string; readonly clientId: string; readonly clientName: string; readonly headline: string; readonly position: number; readonly published: boolean; readonly shots: number };
export type ShowcaseView = {
  readonly waiting: readonly ReviewLine[];
  readonly published: readonly ReviewLine[];
  readonly hidden: readonly ReviewLine[];
  readonly studies: readonly CaseStudyLine[];
  readonly sources: readonly { readonly value: string; readonly label: string }[];
};

export function showcase(deps: ShowcaseDeps, actorId: Id | null): Result<ShowcaseView, "forbidden"> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const lines = deps.reviews.list().map((one): ReviewLine => ({ id: one.id, clientId: one.organizationId, clientName: deps.clientName(one.organizationId) ?? "", stars: stars(one.rating), rating: one.rating, text: one.text, who: [one.displayName, one.town].filter(Boolean).join(", "), source: REVIEW_SOURCE_LABELS[one.source], status: one.status, mayPublish: one.mayPublish, when: deps.formatWhen(one.createdAt) }));
  return ok({
    waiting: lines.filter((one) => one.status === "waiting"),
    published: lines.filter((one) => one.status === "published"),
    hidden: lines.filter((one) => one.status === "hidden"),
    studies: deps.studies.list().map((study) => ({ id: study.id, clientId: study.organizationId, clientName: deps.clientName(study.organizationId) ?? "", headline: study.headline, position: study.position, published: study.published, shots: deps.studies.shots(study.id).length })),
    sources: REVIEW_SOURCES.filter((one) => one !== "client").map((value) => ({ value, label: REVIEW_SOURCE_LABELS[value] })),
  });
}

/** Reviews waiting to be published or kept back, for Today. */
export function reviewsWaiting(deps: ShowcaseDeps, actorId: Id | null): readonly ReviewLine[] {
  const view = showcase(deps, actorId);
  return view.ok ? view.value.waiting : [];
}

export type CaseStudyInput = { readonly headline: string; readonly problem?: string | null; readonly built?: string | null; readonly result?: string | null; readonly liveUrl?: string | null; readonly position?: string | null; readonly published: boolean };

/** Writes a client's case study, or changes it. One per client. */
export function saveCaseStudy(deps: ShowcaseDeps, actorId: Id | null, organizationId: Id, input: CaseStudyInput): Result<CaseStudy, Refused | CaseStudyError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const fields = caseStudyFields(input);
  if (!fields.ok) return fields;
  return deps.transact(() => {
    if (deps.clientName(organizationId) === null) return err("not-found");
    const at = deps.clock();
    const found = deps.studies.forOrganization(organizationId);
    const study: CaseStudy = { id: found?.id ?? deps.newId(), organizationId, ...fields.value, published: input.published };
    if (found) deps.studies.save(study, at);
    else deps.studies.insert(study, at);
    recordActivity(deps, { actorId, action: found ? "case-study.changed" : "case-study.written", recordType: "case-study", recordId: study.id, context: { organizationId, published: study.published } });
    return ok(study);
  });
}

export function addShot(deps: ShowcaseDeps, actorId: Id | null, caseStudyId: Id, input: { readonly bytes: Uint8Array | null; readonly alt: string }): Result<CaseStudy, Refused | ShotError> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const type = checkShot(input.bytes);
  if (!type.ok) return type;
  const alt = shotAlt(input.alt);
  if (!alt.ok) return alt;
  return deps.transact(() => {
    const study = deps.studies.get(caseStudyId);
    if (!study) return err("not-found");
    const shots = deps.studies.shots(caseStudyId);
    if (shots.length >= MAX_SHOTS) return err("too-many-shots");
    const id = deps.newId();
    deps.studies.addShot({ id, caseStudyId, contentType: type.value, alt: alt.value, position: (shots.at(-1)?.position ?? 0) + 1 }, input.bytes as Uint8Array, deps.clock());
    recordActivity(deps, { actorId, action: "case-study.shot-added", recordType: "case-study", recordId: caseStudyId, context: { organizationId: study.organizationId, shotId: id } });
    return ok(study);
  });
}

export function removeShot(deps: ShowcaseDeps, actorId: Id | null, shotId: Id): Result<CaseStudy, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  return deps.transact(() => {
    const shot = deps.studies.shot(shotId);
    const study = shot ? deps.studies.get(shot.caseStudyId) : null;
    if (!shot || !study) return err("not-found");
    deps.studies.removeShot(shotId);
    recordActivity(deps, { actorId, action: "case-study.shot-removed", recordType: "case-study", recordId: study.id, context: { organizationId: study.organizationId, shotId } });
    return ok(study);
  });
}

export type CaseStudyView = {
  readonly organizationId: string;
  readonly clientName: string;
  readonly exists: boolean;
  readonly id: string;
  readonly headline: string;
  readonly problem: string;
  readonly built: string;
  readonly result: string;
  readonly liveUrl: string;
  readonly position: string;
  readonly published: boolean;
  readonly shots: readonly { readonly id: string; readonly alt: string }[];
  readonly canAddShot: boolean;
  /** Who would be asked for a review, or "" when nobody has an email. */
  readonly askWho: string;
  readonly openRequests: number;
};

/** A client's case study and review asking, for the page that edits them. */
export function caseStudyFor(deps: ShowcaseDeps, actorId: Id | null, organizationId: Id): Result<CaseStudyView, Refused> {
  if (!allowed(deps, actorId)) return err("forbidden");
  const name = deps.clientName(organizationId);
  if (name === null) return err("not-found");
  const study = deps.studies.forOrganization(organizationId);
  const shots = study ? deps.studies.shots(study.id) : [];
  const who = deps.contactFor(organizationId);
  return ok({
    organizationId,
    clientName: name,
    exists: study !== null,
    id: study?.id ?? "",
    headline: study?.headline ?? "",
    problem: study?.problem ?? "",
    built: study?.built ?? "",
    result: study?.result ?? "",
    liveUrl: study?.liveUrl ?? "",
    position: String(study?.position ?? 100),
    published: study?.published ?? false,
    shots: shots.map((one) => ({ id: one.id, alt: one.alt })),
    canAddShot: study !== null && shots.length < MAX_SHOTS,
    askWho: who ? `${who.name} (${who.email})` : "",
    openRequests: deps.requests.openFor(organizationId, deps.clock()),
  });
}

/** A screenshot's bytes, for Potomac's people. */
export function shotFor(deps: ShowcaseDeps, actorId: Id | null, shotId: Id): { readonly bytes: Uint8Array; readonly contentType: string } | null {
  if (!allowed(deps, actorId)) return null;
  const shot = deps.studies.shot(shotId);
  return shot ? { bytes: shot.bytes, contentType: shot.contentType } : null;
}

// ---------- What the website reads ----------

export type PublicShowcase = {
  readonly reviews: readonly { readonly rating: number; readonly text: string; readonly name: string; readonly town: string; readonly client: string; readonly source: string; readonly date: string }[];
  readonly caseStudies: readonly { readonly id: string; readonly client: string; readonly headline: string; readonly problem: string; readonly built: string; readonly result: string; readonly url: string; readonly shots: readonly { readonly path: string; readonly alt: string }[] }[];
};

/** Everything published, and nothing else: newest reviews first, case studies in their order. */
export function publicShowcase(deps: ShowcaseDeps): PublicShowcase {
  return {
    reviews: deps.reviews.published().map((one) => ({ rating: one.rating, text: one.text, name: one.displayName, town: one.town, client: deps.clientName(one.organizationId) ?? "", source: one.source, date: one.createdAt.slice(0, 10) })),
    caseStudies: deps.studies
      .list()
      .filter((study) => study.published)
      .map((study) => ({ id: study.id, client: deps.clientName(study.organizationId) ?? "", headline: study.headline, problem: study.problem, built: study.built, result: study.result, url: study.liveUrl, shots: deps.studies.shots(study.id).map((shot) => ({ path: `/api/site/showcase/files/${shot.id}`, alt: shot.alt })) })),
  };
}

/** A published case study's screenshot, for the website. */
export function publicShot(deps: ShowcaseDeps, shotId: Id): { readonly bytes: Uint8Array; readonly contentType: string } | null {
  const shot = deps.studies.shot(shotId);
  const study = shot ? deps.studies.get(shot.caseStudyId) : null;
  return shot && study?.published ? { bytes: shot.bytes, contentType: shot.contentType } : null;
}

import type { CaseStudy, Review } from "../domain/showcase.ts";
import type { Id } from "../../shared/index.ts";

export type ReviewStore = {
  get(id: Id): Review | null;
  /** Newest first. */
  list(): Review[];
  published(): Review[];
  insert(review: Review, requestId: Id | null, at: string): void;
  setStatus(id: Id, status: Review["status"], at: string): void;
  /** Whether a client has written one through a link or the portal. */
  hasClientReview(organizationId: Id): boolean;
};

export type RequestStore = {
  insert(request: { readonly id: Id; readonly organizationId: Id; readonly email: string; readonly tokenHash: string; readonly expiresAt: string; readonly createdBy: Id }, at: string): void;
  byTokenHash(hash: string): { readonly id: Id; readonly organizationId: Id; readonly expiresAt: string; readonly usedAt: string | null } | null;
  markUsed(id: Id, at: string): void;
  /** Requests still open for a client. */
  openFor(organizationId: Id, now: string): number;
};

export type Shot = { readonly id: Id; readonly caseStudyId: Id; readonly contentType: string; readonly alt: string; readonly position: number };

export type CaseStudyStore = {
  get(id: Id): CaseStudy | null;
  forOrganization(organizationId: Id): CaseStudy | null;
  /** By position, then headline. */
  list(): CaseStudy[];
  insert(study: CaseStudy, at: string): void;
  save(study: CaseStudy, at: string): void;
  shots(caseStudyId: Id): Shot[];
  shot(id: Id): (Shot & { readonly bytes: Uint8Array }) | null;
  addShot(shot: Shot, bytes: Uint8Array, at: string): void;
  removeShot(id: Id): void;
};

export type ReviewTokens = { newToken(): string; hash(token: string): string };

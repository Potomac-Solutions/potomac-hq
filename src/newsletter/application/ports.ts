import type { Issue, Stop, Subscriber, SubscriberStatus } from "../domain/newsletter.ts";
import type { Id } from "../../shared/index.ts";

export type SubscriberStore = {
  /** A new subscriber with the hash of their confirm link, when it runs out, and their unsubscribe token. */
  insert(subscriber: Subscriber, tokens: { readonly confirmHash: string; readonly confirmExpiresAt: string; readonly unsubscribeToken: string }): void;
  get(id: Id): Subscriber | null;
  byEmailHash(hash: string): Subscriber | null;
  /** The subscriber whose confirm link this is, with when it runs out. */
  byConfirmHash(hash: string): { readonly subscriber: Subscriber; readonly expiresAt: string } | null;
  byUnsubscribeToken(token: string): Subscriber | null;
  unsubscribeTokenOf(id: Id): string | null;
  /** Saves status, email, name, stop and the times. */
  save(subscriber: Subscriber, at: string): void;
  /** A new confirm link, or none. */
  setConfirm(id: Id, confirm: { readonly hash: string; readonly expiresAt: string } | null, at: string): void;
  remove(id: Id): void;
  /** Everyone who isn't unsubscribed, newest first. */
  listCurrent(): Subscriber[];
  countsByStatus(): Readonly<Record<SubscriberStatus, number>>;
  /** Those on the list now, in these stops (empty: all). */
  subscribedIn(stops: readonly Stop[]): Subscriber[];
};

export type SendStatus = "pending" | "sent" | "failed" | "skipped";

export type IssueStore = {
  insert(issue: Issue, at: string): void;
  save(issue: Issue, at: string): void;
  get(id: Id): Issue | null;
  remove(id: Id): void;
  /** Newest first. */
  list(): Issue[];
  /** Issues being sent now, oldest first. */
  sending(): Issue[];
};

export type SendStore = {
  /** One pending send per subscriber, for an issue that starts going out. */
  addAll(issueId: Id, subscriberIds: readonly Id[], at: string): void;
  /** The next pending sends, oldest first. */
  pending(issueId: Id, limit: number): Id[];
  mark(issueId: Id, subscriberId: Id, status: Exclude<SendStatus, "pending">, at: string): void;
  counts(issueId: Id): Readonly<Record<SendStatus, number>>;
};

/** Random tokens for confirm and unsubscribe links, and the one-way hash kept in their place. */
export type LinkTokens = {
  newToken(): string;
  hash(token: string): string;
};

/** One email out. Headers are for the newsletter's one-click unsubscribe. */
export type NewsletterMail = (message: { readonly to: string; readonly subject: string; readonly body: string; readonly headers?: Readonly<Record<string, string>> }) => Promise<boolean>;

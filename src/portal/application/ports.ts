import type { CallRequest, ClientUser, ProjectUpdate } from "../domain/client-user.ts";
import type { Id } from "../../shared/index.ts";

export type ClientUserStore = {
  insert(user: ClientUser, at: string): void;
  update(user: ClientUser, at: string): void;
  get(id: Id): ClientUser | null;
  byEmail(email: string): ClientUser | null;
  byPortalAccount(account: string): ClientUser | null;
  listFor(organizationId: Id): ClientUser[];
  /** Whether this person is emailed when something is waiting for them. */
  wantsNotices(id: Id): boolean;
  setNotices(id: Id, on: boolean, at: string): void;
  /** The people at a client who can sign in and have not turned notices off. */
  noticeRecipients(organizationId: Id): { readonly name: string; readonly email: string }[];
};

/** One line of the activity log, as the notice sender and the dashboard read it. */
export type LoggedEvent = {
  /** Its place in the log. Later events have a higher number. */
  readonly position: number;
  readonly id: string;
  readonly occurredAt: string;
  readonly actorId: Id | null;
  readonly action: string;
  readonly recordId: string;
  readonly context: Readonly<Record<string, unknown>>;
};

/** Reads the activity log. It never writes to it. */
export type EventReader = {
  /** Events after a place in the log, oldest first. */
  after(position: number, limit: number): LoggedEvent[];
  /** The newest events with one of these actions since an instant, newest first. */
  recent(actions: readonly string[], since: string, limit: number): LoggedEvent[];
  /** How far the notice sender has read. */
  cursor(): number;
  setCursor(position: number, at: string): void;
};

export type UpdateRow = ProjectUpdate & { readonly authorName: string; readonly fromClient: boolean };

export type UpdateStore = {
  insert(update: ProjectUpdate): void;
  /** A project's updates and messages, newest first. */
  listFor(projectId: Id): UpdateRow[];
};

export type CallRow = CallRequest & { readonly clientUserName: string; readonly organizationName: string; readonly createdAt: string };

export type CallStore = {
  insert(request: CallRequest, at: string): void;
  update(request: CallRequest, at: string): void;
  get(id: Id): CallRequest | null;
  /** One client's requests, newest first. */
  listFor(organizationId: Id): CallRow[];
  /** Every request still waiting for an answer, oldest first. */
  waiting(): CallRow[];
};

/**
 * Sign-in for client users: accounts, passwords, sessions and one-time links.
 * Kept apart from HQ's own sign-in, with its own cookie.
 */
export type PortalAuth = {
  /** The portal account a Cookie header is signed in as, or null. */
  session(cookieHeader: string): { readonly account: string } | null;
  signIn(email: string, password: string, client: string): Promise<{ ok: true; cookie: string } | { ok: false; error: "wrong" | "locked" }>;
  /** Ends the session and answers the cookie that clears it. */
  signOut(cookieHeader: string): Promise<string>;
  /** A one-time invite link token for an email. Null if that email already has a portal account. */
  invite(email: string, name: string): Promise<string | null>;
  /** A one-time link token to set a new password. Null if there is no such account. */
  resetLink(account: string): Promise<string | null>;
  /** What a link is for, without using it. */
  peek(token: string): { readonly kind: "invite" | "reset"; readonly email: string } | null;
  /** Uses a link: sets the password and signs the person in. */
  accept(token: string, form: { readonly name: string; readonly password: string }): Promise<{ ok: true; account: string; cookie: string } | { ok: false; message: string }>;
  setDisabled(account: string, disabled: boolean): Promise<void>;
};

/** Someone already on file who matched a sign-up by email or phone. */
export type KnownPerson = {
  /** Where their sign-in link goes: their portal account's email, else the matched contact's. Null when there is none. */
  readonly email: string | null;
  readonly name: string;
  readonly organizationId: string;
  /** True when that email is a portal account that has been turned off. */
  readonly disabled: boolean;
};

/** Finds anyone on file with the same email or phone as a sign-up, by the keys in identity-keys.ts. Demo clients are left out. */
export type PeopleLookup = {
  match(keys: { readonly email: string | null; readonly phone: string | null }): KnownPerson | null;
};

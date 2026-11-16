// The Potomac kit ships no type declarations yet. These cover only what HQ
// uses (docs/decisions/0001-stack.md, "Consequences").

declare module "@potomac-solutions/kit/store" {
  export type KitStore = {
    get(collection: string, key: string): Record<string, unknown> | null;
    under(collection: string, prefix?: string): ({ key: string } & Record<string, unknown>)[];
    write(collection: string, key: string, fields: Record<string, unknown>): Promise<void>;
  };
  export function memoryStore(): KitStore;
  export function checkStore(store: KitStore, assert: unknown, collection?: string): Promise<void>;
}

declare module "@potomac-solutions/kit/staff" {
  import type { KitStore } from "@potomac-solutions/kit/store";

  export type StaffWho = {
    account: string;
    name: string;
    email: string;
    roles: string[];
    disabled: boolean;
    session?: string;
  };
  type Failed = { error: string; ok?: undefined };

  export type Staff = {
    cookieName: string;
    needsOwner(): boolean;
    setup(): Promise<string | null>;
    session(input: unknown): StaffWho | null;
    can(who: StaffWho | null, role: string): boolean;
    signIn(email: string, password: string, options?: { client?: string }): Promise<{ ok: true; account: string; cookie: string } | { error: "wrong" | "locked"; ok?: undefined }>;
    accept(token: string, form: { email?: string; name?: string; password?: string }): Promise<{ ok: true; account: string; cookie: string } | Failed>;
    list(): StaffWho[];
    resetLink(by: { account: string }, account: string): Promise<{ ok: true; token: string } | Failed>;
    setDisabled(by: { account: string }, account: string, disabled: boolean): Promise<{ ok: true } | Failed>;
    endSessions(account: string): Promise<number>;
    signOut(input: unknown): Promise<{ ok: true; cookie: string }>;
    peek(token: string): { kind: "invite" | "reset"; email: string; name: string; setup: boolean } | null;
    invite(by: { account: string }, who: { email: string; name?: string; roles?: string[] }): Promise<{ ok: true; token: string } | Failed>;
    setRoles(by: { account: string }, account: string, roles: string[]): Promise<{ ok: true } | Failed>;
  };

  export function createStaff(options: {
    store: KitStore;
    roles?: string[];
    name?: string;
    secure?: boolean;
    cost?: { N: number; r: number; p: number };
    now?: () => number;
  }): Staff;
}

declare module "@potomac-solutions/kit/staff/pages" {
  import type { IncomingMessage, ServerResponse } from "node:http";
  import type { Staff, StaffWho } from "@potomac-solutions/kit/staff";
  import type { Notices } from "@potomac-solutions/kit/notice";

  export type StaffPages = {
    handle(req: IncomingMessage, res: ServerResponse, url: URL, form: URLSearchParams | null): Promise<boolean>;
    signIn(url: URL): string;
    bar(who: StaffWho): string;
  };
  export function clientAddress(req: IncomingMessage, options?: { proxies?: number }): string;
  export function staffPages(options: {
    staff: Staff;
    home?: string;
    business?: string;
    render: (res: ServerResponse, title: string, body: string) => void;
    secure?: boolean;
    base?: string;
    notices?: Notices;
    proxies?: number;
  }): StaffPages;
}

declare module "@potomac-solutions/kit/notice" {
  export type Notices = {
    sign(location: string): string;
    read(url: URL): { problem: string; done: string };
  };
  export function createNotices(options: { secret: string | Uint8Array }): Notices;
}

declare module "@potomac-solutions/kit/notify" {
  export type NotifySend = (message: { channel: "sms" | "email"; to: string; subject: string; body: string }) => Promise<{ ok: true } | { error: string }>;
  export type Notify = {
    notify(to: { email?: string; sms?: string }, template: string, data?: Record<string, unknown>): Promise<{ ok: true; results: unknown[] } | { error: string; results?: unknown[] }>;
  };
  export function createNotify(options: { send: NotifySend; templates: Record<string, (data: any) => { subject?: string; body: string }> }): Notify;
  export function outbox(): { sent: { channel: string; to: string; subject: string; body: string }[]; send: NotifySend };
}

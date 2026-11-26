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
    /** Each of `keys` ('' unless signed). The first two are always problem and done. */
    read(url: URL): { problem: string; done: string } & Record<string, string>;
  };
  /** `keys` are the query names signed and read, problem and done by default; `max` cuts each one (200). */
  export function createNotices(options: { secret: string | Uint8Array; keys?: readonly string[]; param?: string; max?: number }): Notices;
}

declare module "@potomac-solutions/kit/notify" {
  export type NotifySend = (message: { channel: "sms" | "email"; to: string; subject: string; body: string }) => Promise<{ ok: true } | { error: string }>;
  export type Notify = {
    notify(to: { email?: string; sms?: string }, template: string, data?: Record<string, unknown>): Promise<{ ok: true; results: unknown[] } | { error: string; results?: unknown[] }>;
  };
  export function createNotify(options: { send: NotifySend; templates: Record<string, (data: any) => { subject?: string; body: string }> }): Notify;
  export function outbox(): { sent: { channel: string; to: string; subject: string; body: string }[]; send: NotifySend };
}

declare module "@potomac-solutions/kit/pay" {
  import type { KitStore } from "@potomac-solutions/kit/store";
  export type PayFrame = { readonly kind: string; readonly script: string; readonly token: string };
  export type PayProvider = { readonly name?: string; start?: unknown; check?: unknown; hear?: unknown; refund?: unknown; charge?: unknown };
  export type TestProvider = PayProvider & {
    pageFor(ref: string): { cents: number; currency: string; back: string; paid: boolean } | null;
    approve(ref: string): boolean;
  };
  export type PayDocument = { state?: string; cents?: number; currency?: string; ref?: string; url?: string; frame?: PayFrame | null; payment?: string; recorded?: boolean; at?: number } & Record<string, unknown>;
  export type Settled = { ok: true; id: string; ref: string; cents: number; currency: string; payment: string; again?: true } | { ok?: undefined; error: string; id?: string; ref?: string; payment?: string };
  export type KitPay = {
    paid(id: string): PayDocument | null;
    start(input: { id: string; cents: number; currency?: string; description?: string; back?: string; cancel?: string; email?: string }): Promise<{ ok: true; ref: string; url?: string; frame?: PayFrame; again?: true } | { ok?: undefined; error: string; ref?: string }>;
    settle(input: { id?: string; ref?: string; told?: string }): Promise<Settled>;
    heard(request: { headers: Record<string, string | string[] | undefined>; body: string; url: string }): Promise<Settled | { ok?: undefined; error?: undefined; ignore: true }>;
    refund(input: { id: string; cents?: number }): Promise<{ ok: true; ref: string; cents: number } | { ok?: undefined; error: string }>;
  };
  export function createPay(options: { provider: PayProvider; store: KitStore; collection?: string; now?: () => number; wanted?: (id: string) => boolean }): KitPay;
  export function testProvider(options?: { page?: string }): TestProvider;
}

declare module "@potomac-solutions/kit/pay/providers" {
  import type { PayFrame, PayProvider } from "@potomac-solutions/kit/pay";
  export const PROVIDER_NAMES: readonly string[];
  export function createProviders(settings: Record<string, unknown>, options?: { fetch?: typeof fetch; extra?: Record<string, PayProvider> }): { names: string[]; get(name: string): PayProvider | null };
  export function fromEnv(env: Record<string, string | undefined>): { use: string; settings: Record<string, Record<string, unknown>> };
  export function framePage(frame: PayFrame, options: { ref: string; settle: string; cancel?: string; title?: string; nonce?: string; fields?: Record<string, string>; words?: Record<string, string> }): string;
  export function frameSources(frame: PayFrame | null): { script: string[]; frame: string[] };
}

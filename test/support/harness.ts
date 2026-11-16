// Shared setup for integration tests: a real database built from the repo's
// migrations, the services wired as the app wires them, and, when a test
// needs HTTP, the app on a local port with a small cookie-keeping client.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type App, type AppConfig } from "../../src/app.ts";
import { createHqStaff } from "../../src/identity/adapters.ts";
import { createServices, type Services } from "../../src/services.ts";
import { migrate, newId, openDatabase, readMigrations, systemClock, type Database } from "../../src/shared/adapters.ts";
import type { Id } from "../../src/shared/index.ts";

export const PASSWORD = "correct horse battery";
const migrationsDir = join(import.meta.dirname, "..", "..", "migrations");

export type TestDb = { readonly db: Database; readonly services: Services; close(): void };

/** A fresh database with every migration applied, and the services over it. */
export function testDb(options: { today?: () => string } = {}): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "hq-test-"));
  const db = openDatabase(join(dir, "test.db"));
  migrate(db, readMigrations(migrationsDir), systemClock);
  return {
    db,
    services: createServices(db, options),
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** An HQ user with one role, or with none when `role` is null. */
export function addUser(db: Database, role: string | null, name = `User ${role}`): Id {
  const id = newId();
  db.prepare("insert into user (id, staff_account, name, email, status, created_at, updated_at) values (?, ?, ?, ?, 'active', 'now', 'now')").run(id, `acct-${id}`, name, `${id}@example.com`);
  if (role) db.prepare("insert into user_role (user_id, role_id) select ?, id from role where key = ?").run(id, role);
  return id;
}

export type RecordedEvent = { actor: string | null; action: string; type: string; record: string; context: Record<string, unknown> };

export function events(db: Database): RecordedEvent[] {
  return (db.prepare("select actor_id, action, record_type, record_id, context from activity_event order by rowid").all() as Record<string, string>[]).map((r) => ({
    actor: r["actor_id"] ?? null,
    action: r["action"] as string,
    type: r["record_type"] as string,
    record: r["record_id"] as string,
    context: JSON.parse(r["context"] as string) as Record<string, unknown>,
  }));
}

export const actions = (db: Database): string[] => events(db).map((event) => event.action);

export function count(db: Database, table: string): number {
  return db.prepare(`select count(*) as n from ${table}`).get()?.["n"] as number;
}

export function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) assert.fail(`refused: ${result.error}`);
  return result.value;
}

/** A client with a won opportunity turned into a project, made by `actor`. */
export async function wonProject(services: Services, actor: Id, options: { client?: string; title?: string; pricing?: string; amount?: string } = {}) {
  const crm = await import("../../src/crm/index.ts");
  const client = unwrap(crm.createClient(services.crm, actor, { name: options.client ?? "Mt. Storm Bakery", sizeTier: "small" }));
  const opportunity = unwrap(crm.createOpportunity(services.crm, actor, client.id, { title: options.title ?? "Bakery website", leadSource: "word-of-mouth", service: "website" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(services.crm, actor, opportunity.id, { to }));
  unwrap(crm.setOpportunityValue(services.crm, actor, opportunity.id, { pricing: options.pricing ?? "fixed", amount: options.amount ?? "1500" }));
  for (const to of ["quoted", "won"]) unwrap(crm.moveOpportunity(services.crm, actor, opportunity.id, { to }));
  const project = unwrap(crm.convertOpportunity(services.crm, actor, opportunity.id));
  return { client, opportunity, project };
}

export const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

/** The page as rendered, without Zubra's hydration markers. */
export function visible(html: string): string {
  return html.replace(/<\?zb[^>]*\?>/g, "");
}

/** What a person would read: the body's text, with tags, scripts and prop attributes gone. */
export function textOf(html: string): string {
  const body = html.slice(Math.max(0, html.indexOf("<body")));
  return visible(body)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

export type Client = ReturnType<typeof httpClient>;

/** A browser stand-in: keeps cookies, never follows redirects by itself. */
export function httpClient(origin: string) {
  const jar = new Map<string, string>();
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const res = await fetch(origin + path, { ...init, redirect: "manual", headers: { ...(init.headers as Record<string, string> | undefined), ...(cookie ? { cookie } : {}) } });
    for (const set of res.headers.getSetCookie()) {
      const pair = set.split(";")[0] ?? "";
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  }
  const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = { origin }) =>
    request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString() });
  async function follow(res: Response, path: string): Promise<{ location: string; html: string }> {
    assert.equal(res.status, 303, `${path}: ${res.status} ${await res.clone().text()}`);
    const location = res.headers.get("location") ?? "";
    return { location, html: visible(await (await request(location)).text()) };
  }
  return {
    get: (path: string) => request(path),
    /** The page's HTML, without hydration markers. */
    page: async (path: string) => visible(await (await request(path)).text()),
    post,
    /** Posts, follows the redirect, and returns the page and where it landed. */
    submit: async (path: string, fields: Record<string, string>) => follow(await post(path, fields), path),
    /** Posts a form with one file. */
    async upload(path: string, fields: Record<string, string>, file: { field: string; name: string; bytes: Uint8Array; type?: string }, headers: Record<string, string> = { origin }) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      form.set(file.field, new File([new Uint8Array(file.bytes)], file.name, { type: file.type ?? "application/octet-stream" }));
      return request(path, { method: "POST", headers, body: form });
    },
    follow,
  };
}

export type TestApp = TestDb & { readonly app: App; readonly origin: string; readonly server: Server; stop(): Promise<void> };

export async function testApp(config: Partial<AppConfig> = {}): Promise<TestApp> {
  const base = testDb();
  const app = await createApp({ db: base.db, secure: false, proxies: 0, noticeSecret: "test-secret-test-secret-test-secret-00", attemptsPerMinute: 1000, ...config });
  const server = createServer(app.listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    ...base,
    app,
    origin,
    server,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      base.close();
    },
  };
}

/**
 * Signs someone in. The first person uses the setup link and becomes the
 * admin. Anyone after that is invited through the kit and given an HQ user
 * with the roles asked for.
 */
export async function signIn(t: TestApp, email: string, name: string, roles: string[]): Promise<Client> {
  const b = httpClient(t.origin);
  const setup = await t.app.setupPath();
  if (setup) {
    const token = new URL(t.origin + setup).searchParams.get("token") ?? "";
    assert.equal((await b.post("/staff/accept", { token, email, name, password: PASSWORD })).status, 303);
    return b;
  }
  const staff = createHqStaff(t.db, { secure: false });
  const owner = staff.list().find((one) => one.roles.includes("owner"));
  assert.ok(owner);
  const invite = await (staff as unknown as { invite(by: unknown, who: unknown): Promise<{ token: string }> }).invite(owner, { email, name, roles: ["staff"] });
  assert.equal((await b.post("/staff/accept", { token: invite.token, name, password: PASSWORD })).status, 303);
  const account = staff.list().find((one) => one.email === email);
  assert.ok(account);
  const id = newId();
  t.db.prepare("insert into user (id, staff_account, name, email, status, created_at, updated_at) values (?, ?, ?, ?, 'active', 'now', 'now')").run(id, account.account, name, email);
  for (const role of roles) t.db.prepare("insert into user_role (user_id, role_id) select ?, id from role where key = ?").run(id, role);
  return b;
}

/** The id at the end of a location such as /projects/<id>?done=... */
export function idIn(location: string): string {
  const match = /([0-9a-f]{8}-[0-9a-f-]{27})(?:[/?#]|$)/.exec(location);
  assert.ok(match, `no id in ${location}`);
  return match[1] as string;
}

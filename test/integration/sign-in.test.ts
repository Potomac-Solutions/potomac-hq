// Sign-in end to end over real HTTP: a real server, a real database built
// from the repo's migrations, and the kit's real staff module.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createApp, type App } from "../../src/app.ts";
import { createHqStaff } from "../../src/identity/adapters.ts";
import { migrate, openDatabase, readMigrations, systemClock, type Database } from "../../src/shared/adapters.ts";

const migrationsDir = join(import.meta.dirname, "..", "..", "migrations");
const PASSWORD = "correct horse battery";

let dir: string;
let db: Database;
let app: App;
let server: Server;
let origin: string;
let logged: string[];

async function start(attemptsPerMinute = 100): Promise<void> {
  logged = [];
  app = await createApp({
    db,
    secure: false,
    proxies: 0,
    noticeSecret: "test-secret-test-secret-test-secret-0000",
    attemptsPerMinute,
    log: (message, error) => logged.push(`${message} ${String(error ?? "")}`),
  });
  server = createServer(app.listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "hq-sign-in-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db, readMigrations(migrationsDir), systemClock);
  await start();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A browser's worth of state: one cookie jar. */
function browser() {
  let cookie = "";
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(origin + path, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers as Record<string, string> | undefined), ...(cookie ? { cookie } : {}) },
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const pair = set.split(";")[0] ?? "";
      cookie = pair.endsWith("=") ? "" : pair;
    }
    return res;
  }
  return {
    get: (path: string) => request(path),
    post: (path: string, fields: Record<string, string>) =>
      request(path, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      }),
    raw: request,
    hasCookie: () => cookie !== "",
  };
}

function events(): string[] {
  return (db.prepare("select action from activity_event order by rowid").all() as { action: string }[]).map((e) => e.action);
}

function userCount(): number {
  return db.prepare("select count(*) as n from user").get()?.["n"] as number;
}

async function setUpOwner(b = browser()) {
  const path = await app.setupPath();
  assert.ok(path);
  const token = new URL(origin + path).searchParams.get("token") ?? "";
  const res = await b.post("/staff/accept", { token, email: "Mikey@Example.com", name: "Mikey Nichols", password: PASSWORD });
  assert.equal(res.status, 303, await res.text());
  return b;
}

test("signed out, the home page is the sign-in form and says how to get started", async () => {
  const res = await browser().get("/");
  const html = await res.text();
  assert.equal(res.status, 401);
  assert.match(html, /<form[^>]+action="\/staff\/sign-in"/);
  assert.match(html, /Nobody has an account here yet/);
  assert.doesNotMatch(html, /Sign out/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  // HQ sends no-store; @zubra/router 5.19.0 adds private for a page whose load ran.
  assert.match(res.headers.get("cache-control") ?? "", /(^|,\s*)no-store(\s*,|$)/);
});

test("no page carries an inline script or an inline style block, and the policy allows neither", async () => {
  const b = await setUpOwner();
  const policy = (await b.get("/")).headers.get("content-security-policy") ?? "";
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'self'(;|$)/);
  assert.match(policy, /style-src 'self'(;|$)/);
  for (const path of ["/", "/nothing-here", "/staff/password"]) {
    const html = await (await b.get(path)).text();
    assert.doesNotMatch(html, /<style[\s>]/, path);
    for (const script of html.matchAll(/<script\b[^>]*>/g)) {
      assert.match(script[0], /^<script type="module" src="\/_zubra\/[^"]+"><?/, `${path}: ${script[0]}`);
    }
    assert.doesNotMatch(html, /\son[a-z]+=/, `${path}: inline event handler`);
  }
});

test("every page has a title, and no component is rendered inside itself", async () => {
  const signedOut = await (await browser().get("/")).text();
  assert.match(signedOut, /<title>Sign in<\/title>/);
  const b = await setUpOwner();
  const pages: [string, RegExp][] = [
    ["/", /<title>Home<\/title>/],
    ["/nothing-here", /<title>Page not found<\/title>/],
  ];
  for (const [path, title] of pages) {
    const html = await (await b.get(path)).text();
    assert.match(html, title, path);
    assert.equal(html.match(/<title>/g)?.length, 1, `${path}: one title`);
  }
  // A component imported by both the shell and a page was rendered twice,
  // nested (https://github.com/journey-to-code-org/zubra/issues/300). The shell
  // avoids that. This catches a return.
  for (const html of [signedOut, await (await b.get("/")).text(), await (await b.get("/nothing-here")).text()]) {
    assert.doesNotMatch(html, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/, "a button inside a button");
    assert.doesNotMatch(html, /data-zb-filled="[^"]*"[^>]*data-zb-filled=/, "a component filled twice");
  }
});

test("the theme, the mark and a component's script are served, and nothing else under /assets", async () => {
  const b = browser();
  const css = await b.get("/assets/theme.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /^text\/css/);
  assert.equal((await b.get("/assets/potomac-mark.webp")).headers.get("content-type"), "image/webp");
  assert.equal((await b.get("/assets/..%2f..%2fpackage.json")).status, 404);
  assert.equal((await b.get("/assets/theme.css.map")).status, 404);
  const module = await b.get("/_zubra/components/app.js");
  assert.equal(module.status, 200);
  assert.match(module.headers.get("content-type") ?? "", /javascript/);
});

test("the health check answers without a session", async () => {
  const res = await browser().get("/healthz");
  assert.deepEqual(await res.json(), { ok: true });
});

test("the setup link makes the first admin, signs them in, and records both", async () => {
  const b = await setUpOwner();
  assert.ok(b.hasCookie());

  const home = await b.get("/");
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<span class="hq-who">Mikey Nichols<\/span>/);
  // The v0.1 gate: the dashboard shows your own sign-in in the activity panel.
  assert.match(html, /<li><span>Mikey Nichols signed in<\/span> <time datetime="[^"]+Z">[^<]+<\/time><\/li>/);
  assert.match(html, /Mikey Nichols was added as a user/);

  const user = db.prepare("select name, email, status from user").get();
  assert.deepEqual({ ...user }, { name: "Mikey Nichols", email: "mikey@example.com", status: "active" });
  const roles = db.prepare("select r.key from user_role ur join role r on r.id = ur.role_id").all() as { key: string }[];
  assert.deepEqual(roles.map((r) => r.key), ["admin"]);
  assert.deepEqual(events(), ["user.created", "user.signed-in"]);
  assert.deepEqual(logged, []);
});

test("the setup link works once, and there is no second one", async () => {
  const path = await app.setupPath();
  assert.ok(path);
  const token = new URL(origin + path).searchParams.get("token") ?? "";
  await setUpOwner();
  assert.equal(await app.setupPath(), null);

  const again = await browser().post("/staff/accept", { token, email: "intruder@example.com", name: "Intruder", password: PASSWORD });
  assert.equal(again.status, 200);
  assert.match(await again.text(), /expired/);
  assert.equal(userCount(), 1);
});

test("sign out, a wrong password, then the right one", async () => {
  const b = await setUpOwner();

  assert.equal((await b.post("/staff/sign-out", {})).status, 303);
  assert.equal(b.hasCookie(), false);
  assert.match(await (await b.get("/")).text(), /action="\/staff\/sign-in"/);

  const wrong = await b.post("/staff/sign-in", { email: "mikey@example.com", password: "not the password" });
  assert.equal(wrong.status, 303);
  assert.equal(b.hasCookie(), false);
  const shown = await b.get(wrong.headers.get("location") ?? "/");
  assert.match(await shown.text(), /don’t match/);

  const right = await b.post("/staff/sign-in", { email: "MIKEY@example.com", password: PASSWORD });
  assert.equal(right.status, 303);
  assert.ok(b.hasCookie());
  assert.match(await (await b.get("/")).text(), /<span class="hq-who">Mikey Nichols<\/span>/);

  assert.deepEqual(events(), ["user.created", "user.signed-in", "user.signed-out", "user.signed-in"]);
});

test("a message in the address is shown only if the server signed it", async () => {
  const b = await setUpOwner();
  const html = await (await b.get("/?done=Your+account+was+deleted")).text();
  assert.doesNotMatch(html, /Your account was deleted/);
});

test("changing the password is recorded and the new one works", async () => {
  const b = await setUpOwner();
  const changed = await b.post("/staff/password", { current: PASSWORD, next: "a different long password" });
  assert.match(changed.headers.get("location") ?? "", /done=/);

  const other = browser();
  await other.post("/staff/sign-in", { email: "mikey@example.com", password: PASSWORD });
  assert.equal(other.hasCookie(), false);
  await other.post("/staff/sign-in", { email: "mikey@example.com", password: "a different long password" });
  assert.ok(other.hasCookie());
  assert.deepEqual(events(), ["user.created", "user.signed-in", "user.password-changed", "user.signed-in"]);
});

test("a wrong current password changes nothing and records nothing", async () => {
  const b = await setUpOwner();
  const res = await b.post("/staff/password", { current: "wrong", next: "a different long password" });
  assert.match(res.headers.get("location") ?? "", /problem=/);
  assert.deepEqual(events(), ["user.created", "user.signed-in"]);
});

test("the reset command gives a one-time link that sets a new password", async () => {
  await setUpOwner();
  assert.equal(await app.resetPath("nobody@example.com"), null);
  const path = await app.resetPath("Mikey@Example.com");
  assert.ok(path);
  const token = new URL(origin + path).searchParams.get("token") ?? "";

  const b = browser();
  assert.equal((await b.post("/staff/accept", { token, password: "brand new password" })).status, 303);
  assert.ok(b.hasCookie());

  const old = browser();
  await old.post("/staff/sign-in", { email: "mikey@example.com", password: PASSWORD });
  assert.equal(old.hasCookie(), false);

  const reused = await browser().post("/staff/accept", { token, password: "another password!" });
  assert.match(await reused.text(), /expired/);
  assert.deepEqual(events(), ["user.created", "user.signed-in", "user.reset-link-issued", "user.signed-in"]);
});

test("sign-in attempts are rate limited per address", async () => {
  await setUpOwner();
  await new Promise((resolve) => server.close(resolve));
  await start(3);
  const b = browser();
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await b.post("/staff/sign-in", { email: "mikey@example.com", password: "guess number " + i })).status);
  }
  assert.deepEqual(statuses, [303, 303, 303, 429, 429]);
  const limited = await b.post("/staff/sign-in", { email: "mikey@example.com", password: PASSWORD });
  assert.equal(limited.status, 429, "even the right password waits");
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(b.hasCookie(), false);
});

test("the kit's People pages are not reachable, even for the owner", async () => {
  const b = await setUpOwner();
  assert.equal((await b.get("/staff/people")).status, 404);
  const invite = await b.post("/staff/people/invite", { email: "new@example.com", name: "New", role: "owner" });
  assert.equal(invite.status, 404);
  assert.equal(createHqStaff(db, { secure: false }).list().length, 1);
});

test("a kit account with no HQ user can sign in but gets no access and creates no user", async () => {
  const owner = await setUpOwner();
  void owner;
  // Made directly through the kit, the way a future invite would be.
  const staff = createHqStaff(db, { secure: false });
  const ownerAccount = staff.list()[0];
  assert.ok(ownerAccount);
  const invite = await (staff as unknown as { invite(by: unknown, who: unknown): Promise<{ token: string }> }).invite(ownerAccount, {
    email: "stranger@example.com",
    name: "Stranger",
    roles: ["owner"],
  });

  const b = browser();
  assert.equal((await b.post("/staff/accept", { token: invite.token, name: "Stranger", password: PASSWORD })).status, 303);
  const home = await b.get("/");
  assert.equal(home.status, 403);
  const html = await home.text();
  assert.match(html, /has not been given access/);
  assert.doesNotMatch(html, /signed in<\/span>/, "no activity is shown");
  assert.equal(userCount(), 1);
  assert.deepEqual(events(), ["user.created", "user.signed-in"]);
});

test("a disabled HQ user gets no access, even with a live session", async () => {
  const b = await setUpOwner();
  db.prepare("update user set status = 'disabled'").run();
  const home = await b.get("/");
  assert.equal(home.status, 403);
  assert.doesNotMatch(await home.text(), /hq-activity/);
});

test("oversized and non-form posts are refused before the kit sees them", async () => {
  const b = browser();
  const big = await b.post("/staff/sign-in", { email: "a@example.com", password: "x".repeat(20_000) });
  assert.equal(big.status, 413);
  const json = await b.raw("/staff/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(json.status, 415);
});

test("unknown addresses are 404, under /staff and elsewhere", async () => {
  const b = browser();
  assert.equal((await b.get("/staff/nothing-here")).status, 404);
  const missing = await b.get("/nothing-here");
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /There is no page at this address/);
  assert.equal((await b.raw("/", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: "a=1" })).status, 404);
});

// "Forgot your password?" over real HTTP, with an outbox in place of Brevo.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { createApp, type App } from "../../src/app.ts";
import { migrate, openDatabase, readMigrations, systemClock, type Database } from "../../src/shared/adapters.ts";

const PASSWORD = "correct horse battery";
type Mail = { channel: string; to: string; subject: string; body: string };

async function start(email: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "hq-forgot-"));
  const db = openDatabase(join(dir, "test.db"));
  migrate(db, readMigrations(join(import.meta.dirname, "..", "..", "migrations")), systemClock);
  const sent: Mail[] = [];
  const app = await createApp({
    db,
    secure: false,
    proxies: 0,
    noticeSecret: "forgot-secret-forgot-secret-forgot-00",
    attemptsPerMinute: 1000,
    email: email ? { publicUrl: "https://hq.example", send: async (message) => (sent.push(message), { ok: true }) } : null,
  });
  const server = createServer(app.listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { app, db, origin, sent, stop };
}

let env: Awaited<ReturnType<typeof start>>;
before(async () => {
  env = await start(true);
  const path = await env.app.setupPath();
  const token = new URL(env.origin + path).searchParams.get("token") ?? "";
  await post("/staff/accept", { token, email: "mikey@example.com", name: "Mikey Nichols", password: PASSWORD });
});
after(() => env.stop());
beforeEach(() => {
  env.sent.length = 0;
});

function post(path: string, fields: Record<string, string>) {
  return fetch(env.origin + path, {
    method: "POST",
    redirect: "manual",
    headers: { origin: env.origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}
const visible = (html: string) => html.replace(/<\?zb[^>]*\?>/g, "");
const events = (action: string) => env.db.prepare("select count(*) as n from activity_event where action = ?").get(action)?.["n"];

test("the sign-in page links to the form, and the form asks for an email", async () => {
  const signIn = visible(await (await fetch(env.origin + "/")).text());
  assert.match(signIn, /<a href="\/forgot-password">Forgot your password\?<\/a>/);
  const page = visible(await (await fetch(env.origin + "/forgot-password")).text());
  assert.match(page, /<form method="post" action="\/forgot-password">/);
  assert.match(page, /<title>Forgot your password\?<\/title>/);
});

test("a known email gets a one-time link that sets a new password", async () => {
  const res = await post("/forgot-password", { email: " Mikey@Example.com " });
  assert.equal(res.status, 303);
  const shown = visible(await (await fetch(env.origin + (res.headers.get("location") ?? ""))).text());
  assert.match(shown, /If that email has an account, a link to set a new password is on its way/);

  assert.equal(env.sent.length, 1);
  const mail = env.sent[0];
  assert.ok(mail);
  assert.equal(mail.to, "mikey@example.com");
  assert.equal(mail.subject, "Set a new password for Potomac HQ");
  assert.match(mail.body, /^Hi Mikey Nichols,/);
  const link = /https:\/\/hq\.example(\/staff\/accept\?token=[A-Za-z0-9_-]+)/.exec(mail.body)?.[1];
  assert.ok(link, mail.body);
  assert.equal(events("user.reset-link-emailed"), 1);

  const token = new URL(env.origin + link).searchParams.get("token") ?? "";
  const set = await post("/staff/accept", { token, password: "a brand new password" });
  assert.equal(set.status, 303);
  const again = await post("/staff/accept", { token, password: "another new password" });
  assert.match(await again.text(), /expired/, "the link works once");

  const signIn = await post("/staff/sign-in", { email: "mikey@example.com", password: "a brand new password" });
  assert.match(signIn.headers.get("set-cookie") ?? "", /=[^;]+;/);
});

test("an unknown email gets the same answer and no email", async () => {
  const known = await post("/forgot-password", { email: "mikey@example.com" });
  const unknown = await post("/forgot-password", { email: "nobody@example.com" });
  const strip = (location: string | null) => (location ?? "").replace(/&sig=.*$/, "");
  assert.equal(unknown.status, known.status);
  assert.equal(strip(unknown.headers.get("location")), strip(known.headers.get("location")));
  assert.deepEqual(env.sent.map((m) => m.to), ["mikey@example.com"]);
});

test("a disabled user is sent nothing", async () => {
  env.db.prepare("update user set status = 'disabled'").run();
  try {
    await post("/forgot-password", { email: "mikey@example.com" });
    assert.equal(env.sent.length, 0);
  } finally {
    env.db.prepare("update user set status = 'active'").run();
  }
});

test("one inbox gets at most three links an hour, with the same answer after", async () => {
  // Earlier tests asked for mikey@example.com three times already this hour.
  const res = await post("/forgot-password", { email: "mikey@example.com" });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location") ?? "", /done=/);
  assert.equal(env.sent.length, 0);
});

test("one address may ask five times an hour", async () => {
  // The same test address has asked five times above; the next is refused.
  const res = await post("/forgot-password", { email: "someone-else@example.com" });
  assert.match(new URL(env.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /Too many tries/);
});

test("signed in, the form sends you home; without email, it says who to ask", async () => {
  const off = await start(false);
  try {
    const page = visible(await (await fetch(off.origin + "/forgot-password")).text());
    assert.match(page, /Email isn’t set up yet\. Ask an administrator for a reset link\./);
    assert.doesNotMatch(visible(await (await fetch(off.origin + "/")).text()), /forgot-password/);
    const res = await fetch(off.origin + "/forgot-password", {
      method: "POST",
      redirect: "manual",
      headers: { origin: off.origin, "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40example.com",
    });
    assert.match(new URL(off.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /Email is not set up yet/);
    assert.equal(off.sent.length, 0);
  } finally {
    await off.stop();
  }

  const signedIn = await post("/staff/sign-in", { email: "mikey@example.com", password: "a brand new password" });
  const cookie = (signedIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const home = await fetch(env.origin + "/forgot-password", { redirect: "manual", headers: { cookie } });
  assert.equal(home.status, 303);
  assert.equal(home.headers.get("location"), "/");
});

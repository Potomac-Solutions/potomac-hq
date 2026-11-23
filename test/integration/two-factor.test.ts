// Two-factor sign-in over real HTTP: turning it on with a code from an app,
// the second step at sign-in, recovery codes, turning it off, and an
// admin's reset for a lost phone.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { codeAt, stepOf } from "../../src/identity/adapters.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, httpClient, PASSWORD, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let mikeyId: Id;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const userId = (email: string) => t.db.prepare("select id from user where email = ?").get(email)?.["id"] as Id;
const secretOf = (id: Id) => String(t.db.prepare("select secret from user_two_factor where user_id = ?").get(id)?.["secret"] ?? "");
/** The code an app would show now, or `ahead` steps later. */
const codeNow = (id: Id, ahead = 0) => codeAt(secretOf(id), stepOf(Date.now()) + ahead);
let recovery: string[] = [];

async function passwordOnly(email: string): Promise<Client> {
  const b = httpClient(t.origin);
  const res = await b.post("/staff/sign-in", { email, password: PASSWORD });
  assert.equal(res.status, 303);
  return b;
}

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await mikey.get("/");
  mikeyId = userId("mikey@example.com");
});
after(() => t.stop());

test("turning it on takes a code from the app, and shows the recovery codes once", async () => {
  assert.match(textOf(await mikey.page("/")), /Turn on two-factor sign-in You're an admin/, "an admin without it is reminded");
  const off = await mikey.page("/settings");
  assert.match(textOf(off), /Two-factor sign-in Off Turn it on/);

  const began = await mikey.post("/settings/two-factor", {});
  assert.equal(doneOf(began), "Add HQ to your authenticator app, then enter the code it shows.");
  const setup = await mikey.page("/settings");
  const secret = secretOf(mikeyId);
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.ok(setup.includes(secret.replace(/(.{4})(?=.)/g, "$1 ")), "the key is shown, grouped for typing");
  // Pages can only link to web addresses, so the link that opens the app is a redirect to it.
  assert.ok(setup.includes('href="/settings/two-factor/app"'), "and a link that opens the app");
  const opens = await mikey.get("/settings/two-factor/app");
  assert.equal(opens.status, 302);
  assert.equal(opens.headers.get("location"), `otpauth://totp/Potomac%20HQ%3Amikey%40example.com?secret=${secret}&issuer=Potomac%20HQ`);
  assert.equal(opens.headers.get("cache-control"), "private, no-store");
  assert.equal((await httpClient(t.origin).get("/settings/two-factor/app")).status, 404, "nobody signed in");

  // The QR code: only to its owner, only while turning it on, never kept.
  const qr = await mikey.get("/settings/two-factor/qr.svg");
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get("content-type"), "image/svg+xml");
  assert.equal(qr.headers.get("cache-control"), "private, no-store");
  assert.match(await qr.text(), /^<svg [^>]*aria-label="QR code to add Potomac HQ to your authenticator app"/);
  assert.equal((await httpClient(t.origin).get("/settings/two-factor/qr.svg")).status, 404, "nobody signed in");

  // Still off until it is confirmed: the password alone signs in.
  const other = await passwordOnly("mikey@example.com");
  assert.equal((await other.get("/")).status, 200);

  assert.equal(problemOf(await mikey.post("/settings/two-factor/confirm", { code: "12345" })), "Enter the 6-digit code from your app, or a recovery code like ABCDE-FGHJK.");
  const wrong = codeNow(mikeyId) === "000000" ? "111111" : "000000";
  assert.match(problemOf(await mikey.post("/settings/two-factor/confirm", { code: wrong })), /didn’t match/);

  const confirmed = await mikey.post("/settings/two-factor/confirm", { code: codeNow(mikeyId) });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.headers.get("cache-control"), "no-store");
  const html = await confirmed.text();
  recovery = [...html.matchAll(/<code>([A-Z2-9]{5}-[A-Z2-9]{5})<\/code>/g)].map((m) => m[1] as string);
  assert.equal(recovery.length, 10);
  assert.equal(new Set(recovery).size, 10);
  // Only hashes are kept.
  const stored = t.db.prepare("select code_hash from two_factor_recovery where user_id = ?").all(mikeyId).map((row) => String(row["code_hash"]));
  for (const code of recovery) assert.ok(!stored.includes(code) && !stored.includes(code.replace("-", "")));

  assert.equal((await mikey.get("/settings/two-factor/qr.svg")).status, 404, "not once it is on");
  // The session it was turned on in carries on.
  assert.equal((await mikey.get("/clients")).status, 200);
  assert.match(textOf(await mikey.page("/settings")), /On After your password, HQ asks for a code from your authenticator app\. 10 recovery codes are left\./);
  assert.ok(actions(t.db).includes("user.two-factor-on"));
  assert.doesNotMatch(textOf(await mikey.page("/")), /Turn on two-factor sign-in/, "and not once it is on");
  // Nothing secret reaches the activity log.
  const log = JSON.stringify(t.db.prepare("select * from activity_event").all());
  assert.ok(!log.includes(secretOf(mikeyId)) && !recovery.some((code) => log.includes(code)));
});

test("after the password, nothing in HQ opens until the code is given", async () => {
  const b = await passwordOnly("mikey@example.com");
  const home = await b.get("/");
  assert.equal(home.status, 401);
  const text = textOf(await home.text());
  assert.match(text, /Confirm it’s you/);
  assert.doesNotMatch(text, /Mikey Nichols/, "the top bar does not show them signed in");

  for (const path of ["/clients", "/settings", "/search?q=a", "/people"]) assert.equal((await b.get(path)).status, 401, path);
  // Forms are refused too: the session is not an HQ user yet.
  assert.equal(problemOf(await b.post("/clients", { name: "Sneaky Co" })), "You don’t have permission to do that.");
  assert.equal(problemOf(await b.post("/settings/two-factor/off", { code: codeNow(mikeyId, 1) })), "You don’t have permission to do that.");

  assert.match(problemOf(await b.post("/two-factor", { code: "abc" })), /Enter the 6-digit code/);
  const code = codeNow(mikeyId, 1);
  const passed = await b.post("/two-factor", { code: ` ${code.slice(0, 3)} ${code.slice(3)} ` });
  assert.equal(passed.status, 303);
  assert.equal(passed.headers.get("location"), "/");
  assert.equal((await b.get("/clients")).status, 200);

  // The same code never works twice, even within its 30 seconds.
  const again = await passwordOnly("mikey@example.com");
  assert.equal(problemOf(await again.post("/two-factor", { code })), "That code has been used. Wait for the next one.");
  assert.equal((await again.get("/")).status, 401);
});

test("a recovery code signs in once, and says how many are left", async () => {
  const b = await passwordOnly("mikey@example.com");
  const used = await b.post("/two-factor", { code: (recovery[0] as string).toLowerCase() });
  assert.equal(doneOf(used), "You signed in with a recovery code. 9 are left.");
  assert.equal((await b.get("/clients")).status, 200);

  const c = await passwordOnly("mikey@example.com");
  assert.match(problemOf(await c.post("/two-factor", { code: recovery[0] as string })), /didn’t match/);
  assert.ok(actions(t.db).includes("user.two-factor-recovery-used"));
});

test("the second step is limited to five tries a minute", async () => {
  // Its own server: the limit counts every try in the tests above.
  const own = await testApp();
  try {
    const first = await signIn(own, "ada@example.com", "Ada Owner", ["admin"]);
    await first.get("/");
    await first.post("/settings/two-factor", {});
    const id = own.db.prepare("select id from user where email = 'ada@example.com'").get()?.["id"] as Id;
    const secret = String(own.db.prepare("select secret from user_two_factor where user_id = ?").get(id)?.["secret"]);
    assert.equal((await first.post("/settings/two-factor/confirm", { code: codeAt(secret, stepOf(Date.now())) })).status, 200);
    const b = httpClient(own.origin);
    assert.equal((await b.post("/staff/sign-in", { email: "ada@example.com", password: PASSWORD })).status, 303);
    for (let n = 0; n < 5; n++) assert.equal((await b.post("/two-factor", { code: "999999" })).status, 303);
    assert.equal((await b.post("/two-factor", { code: "999999" })).status, 429);
  } finally {
    await own.stop();
  }
});

test("an admin resets it for a lost phone; nobody resets their own that way", async () => {
  const sam = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  await sam.get("/");
  const samId = userId("sam@example.com");
  assert.doesNotMatch(textOf(await sam.page("/")), /Turn on two-factor sign-in/, "only admins are reminded");
  await sam.post("/settings/two-factor", {});
  assert.equal((await sam.post("/settings/two-factor/confirm", { code: codeNow(samId) })).status, 200);

  const people = await mikey.page("/people");
  assert.match(textOf(people), /Sam Helper sam@example\.com Member · Active · Two-factor on/);
  assert.ok(people.includes(`/people/${samId}/two-factor-reset`));
  assert.ok(!people.includes(`/people/${mikeyId}/two-factor-reset`), "not for yourself");

  assert.equal(problemOf(await sam.post(`/people/${mikeyId}/two-factor-reset`, {})), "You don’t have permission to do that.", "a member may not");
  assert.equal(problemOf(await mikey.post(`/people/${mikeyId}/two-factor-reset`, {})), "Turn off your own in Settings, with a code.");
  assert.match(doneOf(await mikey.post(`/people/${samId}/two-factor-reset`, {})), /Their two-factor sign-in is off/);
  assert.ok(actions(t.db).includes("user.two-factor-reset"));

  const back = await passwordOnly("sam@example.com");
  assert.equal((await back.get("/")).status, 200, "the password alone signs them in again");
});

test("turning it off takes a current code", async () => {
  assert.match(problemOf(await mikey.post("/settings/two-factor/off", { code: "" })), /Enter the 6-digit code/);
  const done = await mikey.post("/settings/two-factor/off", { code: codeNow(mikeyId, 1) });
  assert.equal(doneOf(done), "Two-factor sign-in is off. You sign in with your password alone.");
  assert.equal(t.db.prepare("select count(*) as n from two_factor_recovery where user_id = ?").get(mikeyId)?.["n"], 0);
  const b = await passwordOnly("mikey@example.com");
  assert.equal((await b.get("/")).status, 200);
  assert.ok(actions(t.db).includes("user.two-factor-off"));
});

test("an admin can require it of every admin; one without it can open only Settings until it is on", async () => {
  const own = await testApp();
  try {
    const ada = await signIn(own, "ada@example.com", "Ada Owner", ["admin"]);
    await ada.get("/");
    const ben = await signIn(own, "ben@example.com", "Ben Second", ["admin"]);
    await ben.get("/");
    const cat = await signIn(own, "cat@example.com", "Cat Member", ["member"]);
    await cat.get("/");
    const idOf = (email: string) => own.db.prepare("select id from user where email = ?").get(email)?.["id"] as Id;
    const secretOf2 = (id: Id) => String(own.db.prepare("select secret from user_two_factor where user_id = ?").get(id)?.["secret"]);
    const problem = (res: Response) => new URL(own.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";

    // Not before your own is on.
    assert.match(textOf(await ada.page("/people")), /Sign-in rules Two-factor sign-in is optional for everyone\. .* To require it of admins, turn on yours first\./);
    assert.equal(problem(await ada.post("/people/two-factor-rule", { on: "1" })), "Turn on two-factor sign-in for yourself first, in Settings.");
    assert.equal(problem(await cat.post("/people/two-factor-rule", { on: "1" })), "You don’t have permission to do that.");

    await ada.post("/settings/two-factor", {});
    assert.equal((await ada.post("/settings/two-factor/confirm", { code: codeAt(secretOf2(idOf("ada@example.com")), stepOf(Date.now())) })).status, 200);
    assert.equal(new URL(own.origin + ((await ada.post("/people/two-factor-rule", { on: "1" })).headers.get("location") ?? "")).searchParams.get("done"), "Saved.");
    assert.match(textOf(await ada.page("/people")), /Sign-in rules On Every admin must use two-factor sign-in\./);
    assert.ok(actions(own.db).includes("sign-in-rule.two-factor-required"));

    // Ben, an admin without it, is stopped at every page but Settings, and every form but turning it on.
    const home = await ben.get("/");
    assert.equal(home.status, 403);
    assert.match(textOf(await home.text()), /HQ requires two-factor sign-in for admins/);
    assert.equal((await ben.get("/clients")).status, 403);
    assert.equal(problem(await ben.post("/clients", { name: "Ben Co" })), "You don’t have permission to do that.");
    assert.match(textOf(await ben.page("/settings")), /Required for admins HQ requires two-factor sign-in for admins\. Turn it on to use the rest of HQ\./);
    await ben.post("/settings/two-factor", {});
    assert.equal((await ben.get("/settings/two-factor/qr.svg")).status, 200, "the QR code is part of turning it on");
    assert.equal((await ben.post("/settings/two-factor/confirm", { code: codeAt(secretOf2(idOf("ben@example.com")), stepOf(Date.now())) })).status, 200);
    assert.equal((await ben.get("/clients")).status, 200, "everything opens once it is on");

    // A member is not asked.
    assert.equal((await cat.get("/clients")).status, 200);

    // While it is required, an admin may not turn theirs off.
    assert.equal(problem(await ben.post("/settings/two-factor/off", { code: codeAt(secretOf2(idOf("ben@example.com")), stepOf(Date.now()) + 1) })), "HQ requires two-factor sign-in for admins, so yours stays on.");

    // And back to optional.
    await ada.post("/people/two-factor-rule", { on: "0" });
    assert.match(textOf(await ada.page("/people")), /Two-factor sign-in is optional for everyone/);
    assert.ok(actions(own.db).includes("sign-in-rule.two-factor-optional"));
  } finally {
    await own.stop();
  }
});

test("new recovery codes take a code from the app, replace the old ones, and are shown once", async () => {
  const own = await testApp();
  try {
    const ada = await signIn(own, "ada@example.com", "Ada Owner", ["admin"]);
    await ada.get("/");
    const id = own.db.prepare("select id from user where email = 'ada@example.com'").get()?.["id"] as Id;
    const secret = () => String(own.db.prepare("select secret from user_two_factor where user_id = ?").get(id)?.["secret"]);
    const problem = (res: Response) => new URL(own.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
    const codesIn = async (res: Response) => [...(await res.text()).matchAll(/<code>([A-Z2-9]{5}-[A-Z2-9]{5})<\/code>/g)].map((m) => m[1] as string);

    assert.equal(problem(await ada.post("/settings/two-factor/recovery-codes", { code: "123456" })), "Two-factor sign-in is not on.");
    await ada.post("/settings/two-factor", {});
    const first = await codesIn(await ada.post("/settings/two-factor/confirm", { code: codeAt(secret(), stepOf(Date.now())) }));
    assert.equal(first.length, 10);
    assert.match(textOf(await ada.page("/settings")), /Make new recovery codes/);

    // A recovery code will not do: it takes the app.
    assert.match(problem(await ada.post("/settings/two-factor/recovery-codes", { code: first[0] as string })), /Enter the 6-digit code/);
    const made = await ada.post("/settings/two-factor/recovery-codes", { code: codeAt(secret(), stepOf(Date.now()) + 1) });
    assert.equal(made.status, 200);
    assert.equal(made.headers.get("cache-control"), "no-store");
    const html = await made.clone().text();
    assert.match(html, /New recovery codes/);
    assert.match(html, /Your old recovery codes no longer work/);
    const fresh = await codesIn(made);
    assert.equal(fresh.length, 10);
    assert.ok(fresh.every((code) => !first.includes(code)));
    assert.ok(actions(own.db).includes("user.two-factor-new-codes"));

    // An old one is refused at sign-in, a new one works.
    const b = httpClient(own.origin);
    await b.post("/staff/sign-in", { email: "ada@example.com", password: PASSWORD });
    assert.match(problem(await b.post("/two-factor", { code: first[1] as string })), /didn’t match/);
    assert.equal((await b.post("/two-factor", { code: fresh[0] as string })).status, 303);
    assert.equal((await b.get("/clients")).status, 200);
  } finally {
    await own.stop();
  }
});

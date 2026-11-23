// Passkeys over real HTTP, with a software passkey standing in for the
// browser and the authenticator: turning two-factor sign-in on with one,
// the second step at sign-in, adding one beside an authenticator app,
// removing, and everything a wrong or replayed answer is refused for.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import { codeAt, stepOf } from "../../src/identity/adapters.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, httpClient, PASSWORD, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";
import { softPasskey, type SoftPasskey } from "../support/passkey.ts";

let t: TestApp;
let mikey: Client;
let mikeyId: Id;
let laptop: SoftPasskey;
let recovery: string[] = [];
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const userId = (email: string) => t.db.prepare("select id from user where email = ?").get(email)?.["id"] as Id;
const passkeysOf = (id: Id) => t.db.prepare("select id, label, sign_count, last_used_at from passkey where user_id = ? order by created_at, rowid").all(id);

async function optionsFor(b: Client, purpose: "register" | "verify") {
  const res = await b.post("/passkeys/options", { purpose });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { challenge: string } };
}
/** The second step allows five tries a minute for each person: these tests make more, on purpose. */
const forgetTries = () => t.db.exec("delete from rate_limit where name = 'second-step'");
async function passwordOnly(email: string): Promise<Client> {
  const b = httpClient(t.origin);
  assert.equal((await b.post("/staff/sign-in", { email, password: PASSWORD })).status, 303);
  return b;
}

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await mikey.get("/");
  mikeyId = userId("mikey@example.com");
  laptop = softPasskey();
});
after(() => t.stop());

test("Settings offers a passkey or an app, and the options name this site", async () => {
  const page = textOf(await mikey.page("/settings"));
  assert.match(page, /Two-factor sign-in Off Turn it on/);
  assert.match(page, /With a passkey .* Turn on with a passkey With an authenticator app .* Turn on with an app/);

  const { status, body } = await optionsFor(mikey, "register");
  assert.equal(status, 200);
  assert.deepEqual(body["rp"], { name: "Potomac HQ", id: "127.0.0.1" });
  assert.equal((body["user"] as { name: string }).name, "mikey@example.com");
  assert.match(body.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(body["attestation"], "none");
  assert.deepEqual(body["pubKeyCredParams"], [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }, { type: "public-key", alg: -8 }]);

  assert.equal((await optionsFor(httpClient(t.origin), "register")).status, 403, "nobody signed in");
  assert.equal((await optionsFor(mikey, "verify")).status, 400, "no passkey to use yet");
});

test("a first passkey turns two-factor sign-in on and shows the recovery codes once", async () => {
  // An answer to a challenge HQ never gave, then one from another address: both refused.
  await optionsFor(mikey, "register");
  assert.match(problemOf(await mikey.post("/settings/passkeys", { label: "Laptop", credential: laptop.register({ challenge: "bm90LXRoZS1jaGFsbGVuZ2U" }, t.origin) })), /didn’t check out/);
  assert.match(problemOf(await mikey.post("/settings/passkeys", { label: "Laptop", credential: laptop.register({ challenge: "x" }, t.origin) })), /took too long/, "a challenge is spent by one try");
  const elsewhere = await optionsFor(mikey, "register");
  assert.match(problemOf(await mikey.post("/settings/passkeys", { label: "Laptop", credential: laptop.register(elsewhere.body, "https://hq.evil.example") })), /different address/);
  assert.equal(passkeysOf(mikeyId).length, 0);

  const { body } = await optionsFor(mikey, "register");
  const res = await mikey.post("/settings/passkeys", { label: "  Laptop ", credential: laptop.register(body, t.origin) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const html = await res.text();
  assert.match(textOf(html), /Two-factor sign-in is on From now on, HQ asks for your passkey after your password\./);
  recovery = [...html.matchAll(/<code>([A-Z0-9]{5}-[A-Z0-9]{5})<\/code>/g)].map((m) => m[1] as string);
  assert.equal(recovery.length, 10);

  assert.deepEqual(passkeysOf(mikeyId).map((row) => row["label"]), ["Laptop"]);
  assert.equal(t.db.prepare("select app, confirmed_at is not null as on_ from user_two_factor where user_id = ?").get(mikeyId)?.["app"], 0);
  assert.deepEqual(actions(t.db).slice(-2), ["user.two-factor-on", "user.passkey-added"]);
  const stored = JSON.stringify(t.db.prepare("select context from activity_event order by rowid desc limit 2").all());
  assert.ok(!stored.includes(laptop.id) && !stored.includes(body.challenge), "no credential or challenge in the activity log");

  // The session it was done in carries on; Settings shows the passkey, with no Remove: it is the only way in.
  const page = await mikey.page("/settings");
  assert.match(textOf(page), /On After your password, HQ asks for your passkey\. 10 recovery codes are left\./);
  assert.match(textOf(page), /Laptop Added .* Not used yet\./);
  assert.ok(!page.includes("/remove"), "the last way past the second step can't be removed");
  const only = passkeysOf(mikeyId)[0]?.["id"] as string;
  assert.match(problemOf(await mikey.post(`/settings/passkeys/${only}/remove`, {})), /only way past the second step/);

  // The same passkey twice is refused.
  const again = await optionsFor(mikey, "register");
  assert.deepEqual(again.body["excludeCredentials"], [{ type: "public-key", id: laptop.id }]);
  assert.equal(problemOf(await mikey.post("/settings/passkeys", { credential: laptop.register(again.body, t.origin) })), "That passkey is already added.");
});

test("signing in: the password, then the passkey", async () => {
  const b = await passwordOnly("mikey@example.com");
  const gate = await b.get("/");
  assert.equal(gate.status, 401);
  const page = await gate.text();
  assert.match(textOf(page), /Confirm it’s you .*Continue with a passkey or .*Recovery code/);
  assert.ok(!textOf(page).includes("authenticator app"), "no app was set up, so no code is asked for");
  assert.match(problemOf(await b.post("/two-factor", { code: "123456" })), /didn’t match/, "a 6-digit code is never right without an app");

  const { status, body } = await optionsFor(b, "verify");
  assert.equal(status, 200);
  assert.equal(body["rpId"], "127.0.0.1");
  assert.deepEqual(body["allowCredentials"], [{ type: "public-key", id: laptop.id }]);
  assert.equal((await optionsFor(b, "register")).status, 403, "no adding a passkey before the second step");

  // Signed by some other key: refused, and written down as a refused attempt.
  const stranger = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  assert.match(problemOf(await b.post("/two-factor", { passkey: laptop.assert(body, t.origin, { privateKey: stranger }) })), /didn’t check out/);
  assert.equal((await b.get("/")).status, 401);
  assert.equal(t.db.prepare("select detail from refused_attempt order by rowid desc limit 1").get()?.["detail"], "passkey-signature");

  forgetTries();
  // For another site, and a replay of a spent challenge.
  const other = await optionsFor(b, "verify");
  assert.match(problemOf(await b.post("/two-factor", { passkey: laptop.assert(other.body, t.origin, { rpId: "evil.example" }) })), /different address/);
  const real = await optionsFor(b, "verify");
  const answer = laptop.assert(real.body, t.origin);
  const passed = await b.post("/two-factor", { passkey: answer });
  assert.equal(passed.status, 303);
  assert.equal(passed.headers.get("location"), "/");
  assert.equal((await b.get("/")).status, 200);
  assert.equal(actions(t.db).at(-1), "user.two-factor-passed");
  assert.ok(passkeysOf(mikeyId)[0]?.["last_used_at"], "when it was last used is kept");

  const replay = await passwordOnly("mikey@example.com");
  assert.match(problemOf(await replay.post("/two-factor", { passkey: answer })), /took too long/, "an old answer is no use in a new session");
  assert.equal((await replay.get("/")).status, 401);

  forgetTries();
  // A counter that went backwards means the passkey was copied.
  const copied = await optionsFor(replay, "verify");
  assert.match(problemOf(await replay.post("/two-factor", { passkey: laptop.assert(copied.body, t.origin, { counter: 1 }) })), /may have been copied/);

  // A recovery code still works when the passkey is lost.
  const lost = await passwordOnly("mikey@example.com");
  const used = await lost.post("/two-factor", { code: recovery[0] as string });
  assert.equal(doneOf(used), "You signed in with a recovery code. 9 are left.");
});

test("a second passkey can be added and removed; a passkey proves it is you for new codes and turning off", async () => {
  const phone = softPasskey();
  const { body } = await optionsFor(mikey, "register");
  assert.equal(doneOf(await mikey.post("/settings/passkeys", { label: "Phone", credential: phone.register(body, t.origin) })), "Passkey “Phone” added.");
  const rows = passkeysOf(mikeyId);
  assert.deepEqual(rows.map((row) => row["label"]), ["Laptop", "Phone"]);
  assert.equal((await mikey.page("/settings")).match(/\/settings\/passkeys\/[0-9a-f-]{36}\/remove/g)?.length, 2);

  // Someone else can't remove it.
  const blair = await signIn(t, "blair@example.com", "Blair Lee", ["member"]);
  assert.match(problemOf(await blair.post(`/settings/passkeys/${rows[1]?.["id"] as string}/remove`, {})), /didn’t work|doesn’t exist/);
  assert.equal(passkeysOf(mikeyId).length, 2);
  assert.equal(doneOf(await mikey.post(`/settings/passkeys/${rows[1]?.["id"] as string}/remove`, {})), "Passkey removed.");
  assert.equal(actions(t.db).at(-1), "user.passkey-removed");
  forgetTries();
  const b = await passwordOnly("mikey@example.com");
  const gone = await optionsFor(b, "verify");
  assert.match(problemOf(await b.post("/two-factor", { passkey: phone.assert(gone.body, t.origin) })), /isn’t one of yours/);

  // New recovery codes with the passkey: the old ones stop working.
  const forCodes = await optionsFor(mikey, "verify");
  const fresh = await mikey.post("/settings/two-factor/recovery-codes", { passkey: laptop.assert(forCodes.body, t.origin) });
  assert.equal(fresh.status, 200);
  assert.match(textOf(await fresh.text()), /New recovery codes/);
  assert.match(problemOf(await b.post("/two-factor", { code: recovery[1] as string })), /didn’t match/);

  // Turning it off with the passkey removes the passkeys too.
  assert.match(problemOf(await mikey.post("/settings/two-factor/off", { passkey: "{}" })), /didn’t match/);
  const forOff = await optionsFor(mikey, "verify");
  assert.equal(doneOf(await mikey.post("/settings/two-factor/off", { passkey: laptop.assert(forOff.body, t.origin) })), "Two-factor sign-in is off. You sign in with your password alone.");
  assert.equal(passkeysOf(mikeyId).length, 0);
  assert.equal((await (await passwordOnly("mikey@example.com")).get("/")).status, 200);
});

test("beside an authenticator app: either passes the second step, and the last passkey can be removed", async () => {
  await mikey.post("/settings/two-factor", {});
  const secret = String(t.db.prepare("select secret from user_two_factor where user_id = ?").get(mikeyId)?.["secret"]);
  assert.equal((await mikey.post("/settings/two-factor/confirm", { code: codeAt(secret, stepOf(Date.now())) })).status, 200);
  const { body } = await optionsFor(mikey, "register");
  assert.equal(doneOf(await mikey.post("/settings/passkeys", { credential: laptop.register(body, t.origin) })), "Passkey “Passkey” added.", "a passkey with no name gets a plain one");
  assert.match(textOf(await mikey.page("/settings")), /HQ asks for a code from your authenticator app, or a passkey\./);

  forgetTries();
  const b = await passwordOnly("mikey@example.com");
  assert.match(textOf(await (await b.get("/")).text()), /Continue with a passkey or Open your authenticator app/);
  const { body: verify } = await optionsFor(b, "verify");
  assert.equal((await b.post("/two-factor", { passkey: laptop.assert(verify, t.origin, { counter: 50 }) })).status, 303);
  const c = await passwordOnly("mikey@example.com");
  assert.equal((await c.post("/two-factor", { code: codeAt(secret, stepOf(Date.now()) + 1) })).status, 303, "the app's code still works");

  const id = passkeysOf(mikeyId)[0]?.["id"] as string;
  assert.equal(doneOf(await mikey.post(`/settings/passkeys/${id}/remove`, {})), "Passkey removed.", "the app is still a way in");

  // An admin's reset for a lost phone clears passkeys too.
  const again = await optionsFor(mikey, "register");
  await mikey.post("/settings/passkeys", { credential: softPasskey().register(again.body, t.origin) });
  const sam = await signIn(t, "sam@example.com", "Sam Ortiz", ["admin"]);
  const samOptions = await optionsFor(sam, "register");
  await sam.post("/settings/passkeys", { credential: softPasskey().register(samOptions.body, t.origin) });
  assert.match(doneOf(await sam.post(`/people/${mikeyId}/two-factor-reset`, {})), /two-factor sign-in is off/);
  assert.equal(passkeysOf(mikeyId).length, 0);
});

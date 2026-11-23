import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { calendarConfigFrom, calendarTokenRequest, googleBusyCalendar } from "./google-calendar.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const account = JSON.stringify({ client_email: "hq@potomac.iam.gserviceaccount.com", private_key: pem });
const config = { calendarId: "mikey@example.com", clientEmail: "hq@potomac.iam.gserviceaccount.com", privateKeyPem: pem };

test("it is set up by the calendar's id and a service account, with the sheet's account as a fallback", () => {
  assert.equal(calendarConfigFrom({}), null);
  assert.deepEqual(calendarConfigFrom({ HQ_GOOGLE_CALENDAR_ID: "mikey@example.com", HQ_SHEETS_SERVICE_ACCOUNT: account }), config);
  assert.equal(calendarConfigFrom({ HQ_GOOGLE_CALENDAR_ID: "mikey@example.com", HQ_GOOGLE_SERVICE_ACCOUNT: account, HQ_SHEETS_SERVICE_ACCOUNT: "{}" })?.clientEmail, "hq@potomac.iam.gserviceaccount.com");
  assert.throws(() => calendarConfigFrom({ HQ_GOOGLE_CALENDAR_ID: "mikey@example.com" }), /no service account/);
  assert.throws(() => calendarConfigFrom({ HQ_GOOGLE_CALENDAR_ID: "mikey@example.com", HQ_GOOGLE_SERVICE_ACCOUNT: "not json" }), /key file, as JSON/);
});

test("the sign-in asks for free/busy only, signed with the service account's key", () => {
  const jwt = calendarTokenRequest(config, 1_800_000_000);
  const [header, claims, signature] = jwt.split(".") as [string, string, string];
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), { iss: "hq@potomac.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/calendar.freebusy", aud: "https://oauth2.googleapis.com/token", iat: 1_800_000_000, exp: 1_800_003_600 });
  assert.ok(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url")));
});

function fakeGoogle(answer: (body: Record<string, unknown>) => Response) {
  const calls: { url: string; body: string }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    calls.push({ url: String(url), body });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "token-1", expires_in: 3600 });
    return answer(JSON.parse(body) as Record<string, unknown>);
  }) as typeof fetch;
  return { calls, fake };
}

test("busy times are read for the window, kept a minute, and the token is reused", async () => {
  let at = 1_800_000_000_000;
  const google = fakeGoogle((body) => {
    assert.deepEqual(body, { timeMin: "2026-11-23T00:00:00Z", timeMax: "2026-12-01T00:00:00Z", timeZone: "UTC", items: [{ id: "mikey@example.com" }] });
    return Response.json({ calendars: { "mikey@example.com": { busy: [{ start: "2026-11-24T14:00:00Z", end: "2026-11-24T15:00:00Z" }, { start: "nonsense", end: "x" }] } } });
  });
  const calendar = googleBusyCalendar(config, { fetch: google.fake, now: () => at });
  assert.equal(calendar.name, "Google Calendar mikey@example.com");
  assert.deepEqual(await calendar.busy("2026-11-23T00:00:00Z", "2026-12-01T00:00:00Z"), [{ start: "2026-11-24T14:00:00Z", end: "2026-11-24T15:00:00Z" }]);
  await calendar.busy("2026-11-23T00:00:00Z", "2026-12-01T00:00:00Z");
  assert.equal(google.calls.length, 2, "one sign-in, one free/busy: the second answer came from the minute's cache");
  at += 61_000;
  await calendar.busy("2026-11-23T00:00:00Z", "2026-12-01T00:00:00Z");
  assert.equal(google.calls.filter((one) => one.url.includes("oauth2")).length, 1, "the token is reused");
  assert.equal(google.calls.length, 3);
  assert.ok(!google.calls.some((one) => one.body.includes("token-1")), "the token is sent as a header, never in a body");
});

test("a calendar not shared with HQ, or a refusal, is an error that names no secret", async () => {
  const unshared = googleBusyCalendar(config, { fetch: fakeGoogle(() => Response.json({ calendars: { "mikey@example.com": { errors: [{ domain: "global", reason: "notFound" }] } } })).fake });
  await assert.rejects(unshared.busy("2026-11-23T00:00:00Z", "2026-12-01T00:00:00Z"), /not shared with HQ's service account/);
  const refused = googleBusyCalendar(config, { fetch: fakeGoogle(() => new Response("no", { status: 403 })).fake });
  await assert.rejects(refused.busy("2026-11-23T00:00:00Z", "2026-12-01T00:00:00Z"), (error: Error) => error.message === "Google Calendar free/busy failed: HTTP 403" && !error.message.includes("PRIVATE"));
});

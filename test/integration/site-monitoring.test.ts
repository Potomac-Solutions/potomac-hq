// Site monitoring over real HTTP and the five-minute check, with a stand-in
// checker: added on a client's page, down after two failures with one alert,
// back up with another, an outage recorded, a certificate flagged.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import { checkSites } from "../../src/monitor/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let clientId: Id;
let answer = { ok: true, detail: "200 in 120 ms", certExpiresOn: "2027-06-01" as string | null };
const alerts: { subject: string; body: string }[] = [];
const run = () => checkSites(t.services.monitor, async () => answer, async (message) => (alerts.push(message), true));
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  clientId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" })).id;
});
after(() => t.stop());

test("a site is added on its client's page; inside addresses are refused", async () => {
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/sites`, { url: "http://localhost:3000" })), "Enter the site’s address, like feedstore.com or https://feedstore.com.");
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/sites`, { url: "http://10.0.0.5" })), "That address isn’t on the public internet, so HQ won’t check it.");
  assert.equal(doneOf(await admin.post(`/clients/${clientId}/sites`, { url: "feedstore.com" })), "Watching it. The first check is within five minutes.");
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/sites`, { url: "https://feedstore.com/" })), "That site is already watched.");
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Sites feedstore\.com Not checked yet/);
});

test("checked: up; two failures: down, alerted once, on the dashboard; one good check: back up, alerted", async () => {
  assert.deepEqual(await run(), { checked: 1, down: 0, alerted: 0 });
  assert.match(textOf(await admin.page("/sites")), /All 1 up feedstore\.com · Gormania Feed Up 200 in 120 ms .* 100% up in 30 days Certificate runs out/);
  answer = { ok: false, detail: "HTTP 503", certExpiresOn: null };
  await run();
  assert.equal(alerts.length, 0, "one failure is not an alarm");
  assert.deepEqual(await run(), { checked: 1, down: 1, alerted: 1 });
  assert.equal(alerts[0]?.subject, "Down: feedstore.com (Gormania Feed)");
  await run();
  assert.equal(alerts.length, 1, "no second alarm");
  assert.match(textOf(await admin.page("/")), /Sites that need you feedstore\.com · Gormania Feed Down for \d+ min: HTTP 503/);
  answer = { ok: true, detail: "200 in 95 ms", certExpiresOn: "2027-06-01" };
  await run();
  assert.match(alerts[1]?.subject ?? "", /^Back up: feedstore\.com/);
  assert.match(textOf(await admin.page("/sites")), /Down .*, \d+ min: HTTP 503/);
  assert.ok(actions(t.db).includes("site.down") && actions(t.db).includes("site.up"));
});

test("a certificate two weeks from running out is flagged once", async () => {
  answer = { ok: true, detail: "200 in 95 ms", certExpiresOn: Temporal.Now.plainDateISO("America/New_York").add({ days: 9 }).toString() };
  await run();
  await run();
  assert.equal(alerts.filter((one) => one.subject.startsWith("Certificate running out")).length, 1);
  assert.match(textOf(await admin.page("/")), /Sites that need you feedstore\.com · Gormania Feed Certificate runs out .* in 9 days/);
});

test("stopped, a site is no longer checked", async () => {
  const id = t.db.prepare("select id from monitored_site").get()?.["id"] as string;
  assert.equal(doneOf(await admin.post(`/sites/${id}/stop`, {})), "No longer watched.");
  assert.deepEqual(await run(), { checked: 0, down: 0, alerted: 0 });
});

// Client automations (decision 0013, slice 6) over real HTTP: added to a
// client with a secret check-in address shown once; n8n checks in with ok
// or failed in the query, a form or JSON; one that fails or doesn't run on
// time goes on Today and is alerted once, then once more when it recovers;
// the client sees theirs without anything secret; and who may do what.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import { checkAutomations } from "../../src/automations/index.ts";
import { createServices } from "../../src/services.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let moats: Id;
let address = "";
const alerts: { subject: string; body: string }[] = [];
const alert = async (message: { subject: string; body: string }) => (alerts.push(message), true);
const query = (res: Response, name: string) => new URL(res.headers.get("location") ?? "", "http://x").searchParams.get(name) ?? "";
const checkIn = (path: string, init: RequestInit = {}) => fetch(`${t.origin}${path}`, { method: "POST", ...init });
const stateOf = () => t.db.prepare("select state from automation").get()?.["state"];

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example" });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  moats = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Moats Hardware" })).id;
});
after(() => t.stop());

test("adding an automation shows its secret address once, as a page, never in a redirect", async () => {
  assert.equal(query(await mikey.post(`/clients/${moats}/automations`, { name: "", every: "60" }), "problem"), "Name the automation, like Orders to the sheet.");
  const res = await mikey.post(`/clients/${moats}/automations`, { name: "Orders to the sheet", description: "Copies each web order to the store's sheet.", n8nUrl: "https://n8n.potomac.solutions/workflow/12", every: "60" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const html = await res.text();
  address = /https:\/\/hq\.example(\/hooks\/automations\/[A-Za-z0-9_-]{43})/.exec(html)?.[1] ?? "";
  assert.ok(address, "the address is on the page");
  assert.equal(t.db.prepare("select count(*) as n from automation where token_hash = ?").get(address.split("/").at(-1) ?? "")?.["n"], 0, "only its hash is kept");
  assert.doesNotMatch(await mikey.page(`/clients/${moats}`), new RegExp(address.split("/").at(-1) ?? "x"));
  assert.match(textOf(await mikey.page(`/clients/${moats}`)), /Orders to the sheet Hasn’t run yet Every hour/);
});

test("n8n checks in with ok or failed, in the query, a form or JSON; anything else is refused", async () => {
  assert.equal((await checkIn(`${address}?status=ok`)).status, 200);
  assert.equal(stateOf(), "ok");
  assert.equal((await checkIn(address, { headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "failed", message: "Sheet not found" }) })).status, 200);
  assert.equal(stateOf(), "failed");
  assert.equal((await checkIn(address, { headers: { "content-type": "application/x-www-form-urlencoded" }, body: "status=bogus" })).status, 400);
  assert.equal((await checkIn(`/hooks/automations/${"a".repeat(43)}?status=ok`)).status, 404);
  assert.equal(t.db.prepare("select count(*) as n from automation_run").get()?.["n"], 2);
});

test("a failed one is on Today and alerted once; running again is alerted once too", async () => {
  assert.match(textOf(await mikey.page("/today")), /Orders to the sheet: failed Moats Hardware\. Sheet not found/);
  const services = createServices(t.db, { publicUrl: "https://hq.example" });
  await checkAutomations(services.automations, alert, "https://hq.example");
  await checkAutomations(services.automations, alert, "https://hq.example");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.subject, "Automation failed: Orders to the sheet (Moats Hardware)");
  assert.match(alerts[0]?.body ?? "", /Its last message: Sheet not found[\s\S]*In n8n: https:\/\/n8n\.potomac\.solutions\/workflow\/12/);
  await checkIn(`${address}?status=ok`);
  await checkAutomations(services.automations, alert, "https://hq.example");
  assert.equal(alerts.length, 2);
  assert.equal(alerts[1]?.subject, "Automation is running again: Orders to the sheet (Moats Hardware)");
  assert.doesNotMatch(textOf(await mikey.page("/today")), /Orders to the sheet/);
});

test("one that doesn't check in within its schedule and half again is late", async () => {
  t.db.prepare("update automation set last_run_at = '2026-01-01T00:00:00Z'").run();
  const services = createServices(t.db, { publicUrl: "https://hq.example" });
  assert.deepEqual(await checkAutomations(services.automations, alert, "https://hq.example"), { late: 1, alerted: 1 });
  assert.equal(stateOf(), "late");
  assert.equal(alerts.at(-1)?.subject, "Automation didn’t run on time: Orders to the sheet (Moats Hardware)");
  assert.match(textOf(await mikey.page("/automations")), /Orders to the sheet Moats Hardware Every hour Didn’t run on time/);
});

test("a new address replaces the old one; pausing stops it being late", async () => {
  const id = t.db.prepare("select id from automation").get()?.["id"] as string;
  const res = await mikey.post(`/automations/${id}/secret`, {});
  const fresh = /https:\/\/hq\.example(\/hooks\/automations\/[A-Za-z0-9_-]{43})/.exec(await res.text())?.[1] ?? "";
  assert.equal((await checkIn(`${address}?status=ok`)).status, 404, "the old address no longer works");
  assert.equal((await checkIn(`${fresh}?status=ok`)).status, 200);
  address = fresh;
  assert.equal(query(await mikey.post(`/automations/${id}`, { name: "Orders to the sheet", description: "Copies each web order to the store's sheet.", n8nUrl: "", every: "1440" }), "done"), "Saved.");
  assert.match(textOf(await mikey.page(`/clients/${moats}`)), /Orders to the sheet Paused/);
});

test("the client sees theirs and whether it's running, with no n8n link or address; members can't change them", async () => {
  const id = t.db.prepare("select id from automation").get()?.["id"] as string;
  await mikey.post(`/automations/${id}`, { name: "Orders to the sheet", description: "Copies each web order to the store's sheet.", n8nUrl: "https://n8n.potomac.solutions/workflow/12", every: "1440", active: "1" });
  await checkIn(`${address}?status=ok`);
  const rita = await clientSignedIn(t, mikey, moats, "Rita Moats", "rita@example.com");
  const portal = await rita.page("/portal");
  assert.match(textOf(portal), /Your automations Orders to the sheet ?: Running fine ?, last ran/);
  assert.doesNotMatch(portal, /n8n\.potomac\.solutions|hooks\/automations/);
  assert.equal(query(await sam.post(`/automations/${id}/remove`, {}), "problem"), "You don’t have permission to do that.");
  assert.doesNotMatch(await sam.page(`/clients/${moats}`), /Add an automation/);
  assert.match(textOf(await sam.page("/automations")), /Orders to the sheet/);
  assert.equal(query(await mikey.post(`/automations/${id}/remove`, {}), "done"), "Removed. Its address no longer works.");
  assert.equal((await checkIn(`${address}?status=ok`)).status, 404);
});

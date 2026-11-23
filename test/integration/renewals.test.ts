// Renewals over real HTTP: added on a client's page, shown on the client,
// Renewals and the dashboard by how soon, marked renewed and retired.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let clientId: Id;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const inDays = (days: number) => Temporal.Now.plainDateISO("America/New_York").add({ days }).toString();

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  clientId = unwrap(crm.createClient(t.services.crm, mikey, { name: "Gormania Feed", sizeTier: "small" })).id;
});
after(() => t.stop());

test("renewals are added on a client's page and checked", async () => {
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Renewals Domains, hosting, certificates and licenses this client depends on\./);
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/renewals`, { kind: "domain", name: "", renewsOn: inDays(10), termMonths: "12" })), "Name it: like feedstore.com, or Shared hosting.");
  assert.equal(doneOf(await admin.post(`/clients/${clientId}/renewals`, { kind: "domain", name: "feedstore.com", provider: "Cloudflare", renewsOn: inDays(10), termMonths: "12", cost: "10.44", price: "25", autoRenews: "1" })), "Added. It shows on the dashboard when it is 30 days away.");
  await admin.post(`/clients/${clientId}/renewals`, { kind: "hosting", name: "Shared hosting", renewsOn: inDays(-2), termMonths: "1", cost: "12", price: "30" });
  await admin.post(`/clients/${clientId}/renewals`, { kind: "ssl", name: "Wildcard certificate", renewsOn: inDays(200), termMonths: "12" });
  const page = textOf(await admin.page(`/clients/${clientId}`));
  assert.match(page, /Shared hosting · Hosting Overdue .* Every month/);
  assert.match(page, /feedstore\.com · Domain at Cloudflare .* Every year · renews by itself · costs \$10\.44, billed \$25\.00/);
});

test("Renewals and the dashboard show them by how soon, with a year's cost and billing", async () => {
  const all = textOf(await admin.page("/renewals"));
  assert.match(all, /Over a year they cost \$154\.44 and are billed at \$385\.00\./);
  assert.match(all, /Overdue Shared hosting .* In the next 30 days feedstore\.com .* Later Wildcard certificate/);
  const dashboard = textOf(await admin.page("/"));
  assert.match(dashboard, /Renewals in the next 30 days Shared hosting · Hosting Gormania Feed .* Overdue feedstore\.com · Domain Gormania Feed · renews by itself/);
  assert.doesNotMatch(dashboard, /Wildcard certificate/);
});

test("marked renewed, its date moves on a term; retired, it is gone", async () => {
  const hosting = t.db.prepare("select id, renews_on from renewal where name = 'Shared hosting'").get() as { id: string; renews_on: string };
  assert.equal(doneOf(await admin.post(`/renewals/${hosting.id}/renewed`, { back: "client", clientId })), "Marked renewed. Its next date moved on.");
  const after = t.db.prepare("select renews_on from renewal where id = ?").get(hosting.id)?.["renews_on"];
  assert.equal(after, Temporal.PlainDate.from(hosting.renews_on).add({ months: 1 }).toString());
  const ssl = t.db.prepare("select id from renewal where name = 'Wildcard certificate'").get()?.["id"] as string;
  assert.equal(doneOf(await admin.post(`/renewals/${ssl}/retire`, {})), "Removed from renewals.");
  assert.doesNotMatch(textOf(await admin.page("/renewals")), /Wildcard certificate/);
  assert.ok(actions(t.db).includes("renewal.renewed") && actions(t.db).includes("renewal.retired"));
});

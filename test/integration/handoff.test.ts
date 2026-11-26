// The handoff pack (2026-11-26).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import * as projects from "../../src/projects/index.ts";
import * as renewals from "../../src/renewals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("one zip with renewals and their costs there, sites, shared files, invoices and what they told us", async () => {
  const s = t.services;
  const won = await wonProject(s, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  unwrap(renewals.addRenewal(s.renewals, mikey, won.client.id, { kind: "domain", name: "betterdaystowing.com", provider: "Cloudflare", renewsOn: "2027-03-01", termMonths: "12", cost: "10.44", price: "25" }));
  const shared = unwrap(projects.addDeliverable(s.projects, mikey, won.project.id, { title: "Logo files", file: { name: "logo.pdf", bytes: PDF } }));
  unwrap(projects.setDeliverableShared(s.projects, mikey, shared.id, true));
  unwrap(projects.addDeliverable(s.projects, mikey, won.project.id, { title: "Internal notes", file: { name: "internal.pdf", bytes: PDF } }));
  const inv = unwrap(finance.createInvoice(s.finance, mikey, won.project.id, { kind: "balance", description: "Website build", amount: "900" }));
  unwrap(finance.sendInvoiceNow(s.finance, mikey, inv.id));
  const stacy = await clientSignedIn(t, admin, won.client.id, "Stacy Roberts", "stacy@betterdays.example");
  await stacy.post("/portal/intake", { businessName: "Better Days Towing", hours: "Open 24 hours" });

  assert.match(textOf(await admin.page(`/clients/${won.client.id}`)), /Leaving us, or hosting their own site\?[\s\S]*Download the handoff pack/);
  const res = await admin.get(`/clients/${won.client.id}/handoff.zip`);
  assert.equal(res.status, 200);
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  writeFileSync(join(dir, "pack.zip"), new Uint8Array(await res.arrayBuffer()));
  execFileSync("unzip", ["-q", "pack.zip"], { cwd: dir });
  const root = join(dir, "better-days-towing-handoff");
  const read = (name: string) => readFileSync(join(root, name), "utf8");
  assert.match(read("README.txt"), /Better Days Towing: everything in one place[\s\S]*Domain: ask its registrar/);
  assert.match(read("renewals.csv"), /Domain,betterdaystowing\.com,Cloudflare,2027-03-01,12,no,10\.44,/);
  assert.doesNotMatch(read("renewals.csv"), /25\.00|,25,/, "what we bill them is ours, not theirs to see here");
  assert.match(read("invoices.csv"), /INV-\d{4},\d{4}-\d\d-\d\d,Website build,900\.00,0\.00,Waiting for payment/);
  assert.match(read("about-your-business.txt"), /hours: Open 24 hours/);
  const shown = readdirSync(join(root, "files", "Website-rebuild"));
  assert.deepEqual(shown, ["logo.pdf"], "only what was shared with them");
  assert.match(read("websites.txt"), /No websites on record\./);
});

test("not for someone who can't change a client, nor a client of the portal", async () => {
  const other = await wonProject(t.services, mikey, { client: "Moats Hardware", title: "Store page" });
  const person = await clientSignedIn(t, admin, other.client.id, "Rita Moats", "rita@moats.example");
  assert.equal((await person.get(`/clients/${other.client.id}/handoff.zip`)).status !== 200, true);
  assert.equal((await admin.get("/clients/00000000-0000-4000-8000-000000000999/handoff.zip")).status, 404);
});

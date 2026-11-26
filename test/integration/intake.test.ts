// The new-client intake (2026-11-26): asked once in the portal, read on the
// client's page, files to the project, never a password.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, signIn, testApp, textOf, wonProject, type Client, type TestApp } from "../support/harness.ts";
import { png } from "../support/png.ts";

let t: TestApp;
let admin: Client;
let stacy: Client;
let won: Awaited<ReturnType<typeof wonProject>>;
const said = (res: Response, name: "done" | "problem") => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get(name) ?? "";

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  stacy = await clientSignedIn(t, admin, won.client.id, "Stacy Roberts", "stacy@betterdays.example");
});
after(() => t.stop());


test("the portal asks once; the answers and the logo arrive; the client page shows them", async () => {
  assert.match(textOf(await stacy.page("/portal")), /About your business[\s\S]*Tell us about your business/);
  const page = textOf(await stacy.page("/portal/intake"));
  assert.match(page, /Never send passwords here\./);
  assert.match(page, /They go with “Website rebuild”/);

  assert.equal(said(await stacy.post("/portal/intake", { businessName: " " }), "problem"), "Put your business’s name first.");
  assert.match(said(await stacy.post("/portal/intake", { businessName: "Better Days Towing", hours: "Open 24 hours", "access-facebook": "on", accessNote: "GoDaddy password: tow1234" }), "problem"), /looked like a password, so it was cleared and nothing is saved yet\. The rest of what you typed is still here/);
  assert.equal(t.db.prepare("select count(*) as n from client_intake").get()?.["n"], 0, "nothing saved from a refused try");
  // The form comes back with what they typed, less the password, and says it isn't saved.
  const again = await stacy.page("/portal/intake");
  assert.match(again, /value="Better Days Towing"/);
  assert.match(again, />Open 24 hours<\/textarea>/);
  assert.match(again, /name="access-facebook" checked/);
  assert.doesNotMatch(again, /tow1234/);
  assert.match(textOf(again), /Not saved yet\./);
  assert.doesNotMatch(JSON.stringify(t.db.prepare("select * from kit_document").all()), /tow1234/, "the password is kept nowhere");
  assert.doesNotMatch(textOf(await stacy.page("/portal")), /You told us about your business/);

  const sent = await stacy.upload("/portal/intake", { businessName: "Better Days Towing", tagline: "Towing for Western Maryland", hours: "Open 24 hours\nCall ahead for lockouts", colors: "Red and black", "access-domain": "on", "access-facebook": "on", accessNote: "Domain is with GoDaddy." }, { field: "logo", name: "logo.png", bytes: png(20, 20), type: "image/png" }, { origin: t.origin });
  assert.equal(said(sent, "done"), "Thank you. Potomac Solutions has what it needs to start. Your file is with your project.");
  const file = t.db.prepare("select name, owner_id from file where organization_id = ? and name = 'logo.png'").get(won.client.id);
  assert.equal(file?.["owner_id"], won.project.id);

  const staff = textOf(await admin.page(`/clients/${won.client.id}`));
  assert.match(staff, /About their business[\s\S]*What Stacy Roberts told us in the portal/);
  assert.match(staff, /Hours Open 24 hours\s*Call ahead for lockouts/);
  assert.match(staff, /Accounts they have: Where the domain is registered, Facebook page\. “Domain is with GoDaddy\.”/);
  assert.match(textOf(await stacy.page("/portal")), /You told us about your business/);
  assert.ok(events(t.db).some((one) => one.action === "intake.received"));
});

test("sent again, it's changed in place, and the form shows what they said", async () => {
  const page = await stacy.page("/portal/intake");
  assert.match(page, /value="Towing for Western Maryland"/);
  assert.match(page, /name="access-facebook" checked/);
  assert.equal(said(await stacy.post("/portal/intake", { businessName: "Better Days Towing LLC", "access-domain": "on" }), "done"), "Saved. Potomac Solutions sees your changes.");
  assert.equal(t.db.prepare("select count(*) as n from client_intake").get()?.["n"], 1);
  assert.match(textOf(await admin.page(`/clients/${won.client.id}`)), /Better Days Towing LLC/);
  assert.ok(events(t.db).some((one) => one.action === "intake.changed"));
});

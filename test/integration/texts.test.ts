// Text message reminders (2026-11-26): only to people who said yes in the
// portal, alongside invoice and call reminders, and STOP is honoured.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import { createServices } from "../../src/services.ts";
import type { TextResult } from "../../src/shared/adapters.ts";
import type { Id } from "../../src/shared/index.ts";
import { invoiceReminderText, textClient, textClientPerson } from "../../src/texting/index.ts";
import { clientSignedIn, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

const texted: { to: string; body: string }[] = [];
let answer: TextResult = { ok: true };
const sender = async (to: string, body: string) => (texted.push({ to, body }), answer);
let t: TestApp;
let admin: Client;
let mikey: Id;
const texting = () => createServices(t.db, { texts: sender }).texting;
const doneOf = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";
const problemOf = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";

before(async () => {
  t = await testApp({ texts: sender });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("not offered when no text provider is set up", async () => {
  const plain = await testApp();
  try {
    const boss = await signIn(plain, "mikey@example.com", "Mikey Nichols", ["admin"]);
    await boss.get("/");
    const id = plain.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
    const won = await wonProject(plain.services, id, { client: "Moats Hardware", title: "Store page" });
    const rita = await clientSignedIn(plain, boss, won.client.id, "Rita Moats", "rita@moats.example");
    assert.doesNotMatch(textOf(await rita.page("/portal")), /Text me reminders/);
    assert.equal(problemOf(await rita.post("/portal/texts", { phone: "304-555-0142", agree: "yes" })), "Texts aren’t available yet.");
  } finally {
    await plain.stop();
  }
});

test("a client says yes with their number; invoice reminders then go by text too; STOP ends it", async () => {
  const s = t.services;
  const won = await wonProject(s, mikey, { client: "Gormania Feed", title: "Feed store website" });
  unwrap(crm.addContact(s.crm, mikey, won.client.id, { name: "Bob Miller", email: "bob@feed.example", isPrimary: true }));
  const bob = await clientSignedIn(t, admin, won.client.id, "Bob Miller", "bob@feed.example");
  assert.match(textOf(await bob.page("/portal")), /Text me reminders .* Your mobile number/);
  assert.equal(problemOf(await bob.post("/portal/texts", { phone: "555-0142", agree: "yes" })), "Check the number: a US mobile number, like 304-555-0142.");
  assert.equal(problemOf(await bob.post("/portal/texts", { phone: "304-555-0142" })), "Tick the box to say it’s OK to text you.");
  assert.match(doneOf(await bob.post("/portal/texts", { phone: "(304) 555-0142", agree: "yes" })), /We’ll text \(304\) 555-0142 reminders/);
  assert.match(textOf(await bob.page("/portal")), /We text \(304\) 555-0142 the day before a call/);

  const invoice = unwrap(finance.createInvoice(s.finance, mikey, won.project.id, { kind: "full", description: "Website", amount: "1200", dueOn: "2026-12-04" }));
  unwrap(finance.sendInvoiceNow(createServices(t.db, { today: () => "2026-11-20" }).finance, mikey, invoice.id));
  await admin.post("/money/reminders", { on: "1" });
  const day = "2026-12-05";
  const later = createServices(t.db, { today: () => day, clock: () => `${day}T14:00:00Z`, texts: sender });
  const run = await finance.sendInvoiceReminders(later.invoiceReminders, async () => true, { publicUrl: "https://hq.example", phone: "", address: "" }, (orgId, r) => textClient(later.texting, orgId, "invoice-reminder", invoiceReminderText({ ...r, portalUrl: "https://hq.example/portal" })));
  assert.equal(run.texted, 1);
  assert.equal(texted.at(-1)?.to, "+13045550142");
  assert.match(texted.at(-1)?.body ?? "", /^Potomac Solutions: INV-\d{4} for \$1,200\.00 was due .*https:\/\/hq\.example\/portal Reply STOP to stop texts\.$/);

  // They replied STOP to the number: the next send fails, and we stop too.
  answer = { ok: false, stopped: true, reason: "twilio-21610" };
  const userId = t.db.prepare("select client_user_id from text_consent").get()?.["client_user_id"] as Id;
  assert.equal(await textClientPerson(texting(), userId, "call-reminder", "x"), false);
  answer = { ok: true };
  const before = texted.length;
  assert.equal(await textClientPerson(texting(), userId, "call-reminder", "x"), false);
  assert.equal(texted.length, before, "no more texts after STOP");
  assert.match(textOf(await bob.page("/portal")), /Text me reminders .* Your mobile number/);
  assert.deepEqual(t.db.prepare("select outcome from text_sent order by rowid").all().map((r) => r["outcome"]), ["sent", "twilio-21610"]);
});

test("turning texts off in the portal; turning them back on", async () => {
  const won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website" });
  const stacy = await clientSignedIn(t, admin, won.client.id, "Stacy Roberts", "stacy@betterdays.example");
  await stacy.post("/portal/texts", { phone: "304-555-0199", agree: "yes" });
  assert.equal(await textClient(texting(), won.client.id, "invoice-reminder", "hi"), 1);
  assert.equal(doneOf(await stacy.post("/portal/texts/stop", {})), "Texts are off. Email reminders carry on as before.");
  assert.equal(await textClient(texting(), won.client.id, "invoice-reminder", "hi"), 0);
  await stacy.post("/portal/texts", { phone: "304-555-0199", agree: "yes" });
  assert.equal(await textClient(texting(), won.client.id, "invoice-reminder", "hi"), 1);
  const logged = t.db.prepare("select action from activity_event where record_id = ? and action like 'client.texts-%' order by rowid").all(won.client.id).map((r) => r["action"]);
  assert.deepEqual(logged, ["client.texts-on", "client.texts-off", "client.texts-on"]);
});

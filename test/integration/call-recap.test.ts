// The recap email after a call (decision 0009, slice 6) against a real
// database and over real HTTP: drafted from the notes, edited, sent only when
// pressed, once, and logged as an email; and with email off or no address.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let shop: Id;
let failNext = false;
const sent: { to: string; subject: string; body: string }[] = [];
const query = (res: Response, name: string) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get(name) ?? "";
const path = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).pathname;
const callIn = (res: Response) => path(res).split("/")[2] ?? "";

before(async () => {
  t = await testApp({
    email: {
      publicUrl: "https://hq.example",
      send: async (message) => {
        if (failNext) {
          failNext = false;
          return { error: "test" };
        }
        sent.push({ to: message.to, subject: message.subject, body: message.body });
        return { ok: true };
      },
    },
  });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  shop = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Hensley Body Shop" })).id;
  unwrap(crm.addContact(t.services.crm, mikeyId, shop, { name: "Dale Hensley", email: "dale@example.com", phone: "304-555-0100", isPrimary: true }));
  sent.length = 0;
});
after(() => t.stop());

test("tick it when ending a talk, read the draft, send it once, and it's in the call log", async () => {
  const id = callIn(await mikey.post("/phone", { clientId: shop }));
  assert.match(textOf(await mikey.page(`/phone/${id}`)), /Then write Dale Hensley a recap email, to read before it goes/);
  assert.equal((await mikey.get(`/phone/${id}/recap`)).status, 404, "not while the call is on");
  await mikey.post(`/phone/${id}/answers`, { "asked-5": "on", "answer-5": "About $3,000" });
  const ended = await mikey.post(`/phone/${id}/end`, { outcome: "reached", note: "Online booking first. Quote by Friday.", recap: "on" });
  assert.equal(path(ended), `/phone/${id}/recap`);
  const page = textOf(await mikey.page(`/phone/${id}/recap`));
  assert.match(page, /To Dale Hensley <dale@example\.com>\./);
  const draft = crm.recapFor(t.services.calls, mikeyId, id as Id);
  assert.ok(draft.ok);
  assert.match(draft.value.body, /^Hi Dale,\n\nThanks for the call today\.\n\nHere's what we covered:\n\nOnline booking first\. Quote by Friday\./);
  assert.match(page, /Message Hi Dale, Thanks for the call today\. Here's what we covered: Online booking first\. Quote by Friday\./);
  assert.doesNotMatch(await mikey.page(`/phone/${id}/recap`), /About \$3,000/, "the guide's answers stay in HQ");
  assert.equal(sent.length, 0, "nothing goes until Send is pressed");

  assert.equal(query(await sam.post(`/phone/${id}/recap`, { subject: "x", body: "x" }), "problem"), "That record doesn’t exist.", "only who made the call");
  assert.match(query(await mikey.post(`/phone/${id}/recap`, { subject: "", body: "x" }), "problem"), /Give the email a subject/);
  failNext = true;
  assert.match(query(await mikey.post(`/phone/${id}/recap`, { subject: "Our call", body: "Hi Dale" }), "problem"), /didn’t go/);
  assert.equal(t.db.prepare("select recap_sent_at from call where id = ?").get(id)?.["recap_sent_at"], null);

  const done = await mikey.post(`/phone/${id}/recap`, { subject: "Our call today", body: "Hi Dale,\n\nQuote by Friday.\n\nMikey" });
  assert.equal(query(done, "done"), "Recap sent to Dale Hensley. It’s in the call log.");
  assert.equal(path(done), `/clients/${shop}`);
  assert.deepEqual(sent, [{ to: "dale@example.com", subject: "Our call today", body: "Hi Dale,\n\nQuote by Friday.\n\nMikey" }]);
  assert.match(textOf(await mikey.page(`/clients/${shop}`)), /Email with Dale Hensley Sent a recap of the call: “Our call today”\. Hi Dale,/);
  assert.match(textOf(await mikey.page(`/phone/${id}/recap`)), /Sent to Dale Hensley on .* It’s in the call log\./);
  assert.match(query(await mikey.post(`/phone/${id}/recap`, { subject: "Again", body: "Again" }), "problem"), /already sent/);
  assert.equal(sent.length, 1);
  assert.ok(t.db.prepare("select 1 from activity_event where action = 'call.recap-sent' and record_id = ?").get(id));
});

test("not ticked, or no answer: no recap step", async () => {
  const id = callIn(await mikey.post("/phone", { clientId: shop }));
  assert.equal(path(await mikey.post(`/phone/${id}/end`, { outcome: "voicemail", recap: "on" })), `/clients/${shop}`);
  const other = callIn(await mikey.post("/phone", { clientId: shop }));
  assert.equal(path(await mikey.post(`/phone/${other}/end`, { outcome: "reached", note: "Quick one." })), `/clients/${shop}`);
});

test("a contact with no email: no tick box, and the page says why", async () => {
  const farm = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Laurel Run Farm" })).id;
  unwrap(crm.addContact(t.services.crm, mikeyId, farm, { name: "June Laurel", phone: "304-555-0123", isPrimary: true }));
  const id = callIn(await mikey.post("/phone", { clientId: farm }));
  assert.doesNotMatch(textOf(await mikey.page(`/phone/${id}`)), /recap email/);
  await mikey.post(`/phone/${id}/end`, { outcome: "reached", note: "Wants a quote." });
  assert.match(textOf(await mikey.page(`/phone/${id}/recap`)), /Their contact has no email in HQ/);
});

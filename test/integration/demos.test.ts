// Demo tracking (decision 0010, slice 9) over real HTTP: the Lab's demos
// are kept by managers and admins; demos are emailed from an opportunity,
// each with a link of its own and the demo sign-in; opens are counted (not a
// preview's) and shown on the opportunity, and on Today until someone talks
// to them; a demo that was sent stays.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const sent: { to: string; subject: string; body: string }[] = [];
let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let lead: Id;
const query = (res: Response, name: string) => new URL(res.headers.get("location") ?? "", "http://x").searchParams.get(name) ?? "";
const open = (path: string, agent = PHONE) => fetch(`${t.origin}${path}`, { redirect: "manual", headers: { "user-agent": agent } });
const demoId = (name: string) => t.db.prepare("select id from demo where name = ?").get(name)?.["id"] as string;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, publicUrl: "https://hq.example", email: { publicUrl: "https://hq.example", send: async (message) => (sent.push({ to: message.to, subject: message.subject, body: message.body }), { ok: true }) } });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const client = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Brenda’s Pizzeria" }));
  const contact = unwrap(crm.addContact(t.services.crm, mikeyId, client.id, { name: "Brenda Kight", email: "brenda@example.com", isPrimary: true }));
  lead = unwrap(crm.createOpportunity(t.services.crm, mikeyId, client.id, { title: "Ordering site", leadSource: "phone", contactId: contact.id })).id;
});
after(() => t.stop());

test("managers and admins keep the demos and their sign-ins; members can't", async () => {
  assert.equal(query(await mikey.post("/demos", { name: "Counter", url: "http://counter.example" }), "problem"), "Enter the demo’s https address, like https://counter.potomac.solutions.");
  assert.equal(query(await mikey.post("/demos", { name: "Counter", url: "https://counter.potomac.solutions", description: "Ordering and parts lookup.", signIn: "owner@counter.demo\ndemo1234" }), "done"), "Added.");
  assert.equal(query(await mikey.post("/demos", { name: "Tailgate", url: "https://tailgate.potomac.solutions", description: "A food truck’s orders." }), "done"), "Added.");
  assert.equal((await sam.get("/demos")).status, 403);
  assert.equal(query(await sam.post("/demos", { name: "Mine", url: "https://x.potomac.solutions" }), "problem"), "You don’t have permission to do that.");
});

test("sending emails a link to each demo with its sign-in; only then are the links kept", async () => {
  assert.equal(query(await sam.post(`/opportunities/${lead}/demos`, {}), "problem"), "Tick at least one demo to send.");
  const res = await sam.post(`/opportunities/${lead}/demos`, { [`demo-${demoId("Counter")}`]: "1", [`demo-${demoId("Tailgate")}`]: "1", note: "Great talking today!" });
  assert.equal(query(res, "done"), "Sent 2 demos to brenda@example.com. You’ll see here when they’re opened.");
  const mail = sent.at(-1);
  assert.equal(mail?.subject, "Demos to try: Counter and Tailgate");
  assert.match(mail?.body ?? "", /^Hi Brenda,\n\nGreat talking today!/);
  assert.match(mail?.body ?? "", /Counter: Ordering and parts lookup\.\nhttps:\/\/hq\.example\/d\/[a-z2-9]{8}\nSign in with:\nowner@counter\.demo\ndemo1234/);
  assert.equal(t.db.prepare("select count(*) as n from demo_link").get()?.["n"], 2);
  assert.match(textOf(await mikey.page(`/opportunities/${lead}`)), /Counter , sent .*: not opened yet/);
});

test("an open is counted and sent on; a preview isn't; the opportunity and Today show it until someone talks to them", async () => {
  const code = /https:\/\/hq\.example\/d\/([a-z2-9]{8})/.exec(sent.at(-1)?.body ?? "")?.[1] ?? "";
  const first = await open(`/d/${code}`);
  assert.equal(first.status, 302);
  assert.equal(first.headers.get("location"), "https://counter.potomac.solutions");
  await open(`/d/${code}`);
  await open(`/d/${code}`, "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)");
  assert.equal((await open("/d/zzzzzzzz")).status, 404);
  assert.equal(t.db.prepare("select count(*) as n from demo_open").get()?.["n"], 2);
  assert.match(textOf(await mikey.page(`/opportunities/${lead}`)), /Counter , sent .*: opened 2 times, last/);
  assert.match(textOf(await mikey.page("/today")), /Brenda Kight looked at Counter: follow up Brenda’s Pizzeria · 2 opens/);
  unwrap(crm.logTouch(t.services.touches, mikeyId, { opportunityId: lead }, { kind: "call", outcome: "reached", note: "Loved the demo" }));
  assert.doesNotMatch(textOf(await mikey.page("/today")), /looked at Counter/);
});

test("a demo that was sent stays: it's turned off, and its links still work", async () => {
  assert.equal(query(await mikey.post(`/demos/${demoId("Counter")}/remove`, {}), "problem"), "That demo has been sent, so it stays. Turn it off instead.");
  assert.equal(query(await mikey.post(`/demos/${demoId("Counter")}`, { name: "Counter", url: "https://counter.potomac.solutions", description: "", signIn: "" }), "done"), "Saved.");
  assert.doesNotMatch(await mikey.page(`/opportunities/${lead}`), new RegExp(`name="demo-${demoId("Counter")}"`), "an off demo isn't offered");
  const code = /https:\/\/hq\.example\/d\/([a-z2-9]{8})/.exec(sent.at(-1)?.body ?? "")?.[1] ?? "";
  assert.equal((await open(`/d/${code}`)).status, 302);
});

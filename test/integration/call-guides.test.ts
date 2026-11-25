// Call guides and talking points (decision 0009, slice 2) against a real
// database and over real HTTP: the guide picked for the client, answers
// saved as they're typed and switched between guides, the summary in the
// call log, talking points only for those who may see them, and editing the
// guides.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
const query = (res: Response, name: string) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get(name) ?? "";
const callIn = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).pathname.split("/")[2] ?? "";
const now = () => new Date().toISOString();
const daysFromToday = (days: number) => Temporal.Now.plainDateISO("America/New_York").add({ days }).toString();

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("a new prospect gets the first-call guide; answers save, switch and end up in the log", async () => {
  const shop = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Hensley Body Shop", phone: "304-555-0199" }));
  const id = callIn(await mikey.post("/phone", { clientId: shop.id }));
  const page = textOf(await mikey.page(`/phone/${id}`));
  assert.match(page, /First call A prospect with no proposal yet\. .* What does the business do, and who are its customers\? .* Who else has a say in the decision\?/);
  assert.doesNotMatch(page, /Worth raising/, "nothing to raise yet");
  assert.match(page, /7 questions not asked yet\./);

  // Answers save as typed; a question ticked the first time is recorded once.
  assert.equal(query(await mikey.post(`/phone/${id}/answers`, { "asked-1": "on", "answer-1": "Collision repair, local drivers.", "answer-5": "About $3,000" }), "done"), "Answers saved.");
  await mikey.post(`/phone/${id}/answers`, { "asked-1": "on", "answer-1": "Collision repair, local drivers.", "answer-5": "About $3,000" });
  assert.equal(t.db.prepare("select count(*) as n from activity_event where action = 'call.answered' and record_id = ?").get(id)?.["n"], 1);
  assert.match(textOf(await mikey.page(`/phone/${id}`)), /5 questions not asked yet\./);
  assert.match(await mikey.page(`/phone/${id}`), /Collision repair, local drivers\.<\/textarea>/);
  assert.match(query(await mikey.post(`/phone/${id}/answers`, { "answer-2": "x".repeat(1001) }), "problem"), /under 1,000 characters/);

  // Switch guides; the first guide's answers are kept.
  assert.match(query(await mikey.post(`/phone/${id}/guide`, { situation: "nonsense" }), "problem"), /Choose a guide/);
  assert.equal(query(await mikey.post(`/phone/${id}/guide`, { situation: "any" }), "done"), "Guide changed.");
  assert.match(textOf(await mikey.page(`/phone/${id}`)), /Any call .* Why did they call, or why did we\?/);
  await mikey.post(`/phone/${id}/answers`, { "asked-3": "on", "answer-3": "Send a quote Friday." });

  // Ending: notes first, then each question asked or answered.
  await mikey.post(`/phone/${id}/end`, { outcome: "reached", note: "Good first call." });
  const note = t.db.prepare("select note from touch where call_id = ?").get(id)?.["note"];
  assert.equal(note, "Good first call.\n\n- What does the business do, and who are its customers? Collision repair, local drivers.\n- Roughly what budget do you have in mind? About $3,000\n- What's the next step, and who takes it? Send a quote Friday.");
  // Nobody else's answers: Sam can't save to Mikey's call.
  assert.equal(query(await sam.post(`/phone/${id}/answers`, { "asked-1": "on" }), "problem"), "That record doesn’t exist.");
});

test("an active project's call: a check-in, with talking points each person may see", async () => {
  const { client, project } = await wonProject(t.services, mikeyId, { client: "Elk Diner", title: "Diner website" });
  // Records worth raising, written as the other modules would.
  const invoiceId = "00000000-0000-4000-8000-00000000a001";
  t.db.prepare("insert into invoice (id, project_id, number, kind, status, lines, total_minor, currency, issued_on, due_on, note, created_by, created_at, updated_at) values (?, ?, 41, 'full', 'sent', '[]', 120000, 'USD', ?, ?, '', ?, ?, ?)").run(invoiceId, project.id, daysFromToday(-30), daysFromToday(-12), mikeyId, now(), now());
  t.db.prepare("insert into monitored_site (id, organization_id, url, active, state, failures, down_since, created_at, updated_at) values (?, ?, 'https://elkdiner.example', 1, 'down', 3, ?, ?, ?)").run("00000000-0000-4000-8000-00000000a002", client.id, now(), now(), now());
  t.db.prepare("insert into renewal (id, organization_id, kind, name, provider, renews_on, term_months, auto_renews, note, active, created_at, updated_at) values (?, ?, 'domain', 'elkdiner.com', 'Cloudflare', ?, 12, 0, '', 1, ?, ?)").run("00000000-0000-4000-8000-00000000a003", client.id, daysFromToday(9), now(), now());
  unwrap(crm.logTouch(t.services.touches, mikeyId, { clientId: client.id }, { kind: "call", outcome: "reached", note: "Wants the menu online first." }));

  const id = callIn(await mikey.post("/phone", { clientId: client.id }));
  assert.equal(t.db.prepare("select guide from call where id = ?").get(id)?.["guide"], "project-check-in");
  const page = textOf(await mikey.page(`/phone/${id}`));
  assert.match(page, /Project check-in An active project\./);
  assert.match(page, /Worth raising/);
  assert.match(page, /Money INV-0041 is 12 days late: \$1,200\.00\./);
  assert.match(page, /Site Their site https:\/\/elkdiner\.example is down, since/);
  assert.match(page, /Renewal elkdiner\.com renews in 9 days\./);
  assert.match(page, /Last call, .*: Wants the menu online first\./);
  await mikey.post(`/phone/${id}/end`, { outcome: "no-answer" });

  // Sam, a member, sees no money.
  const samsCall = callIn(await sam.post("/phone", { clientId: client.id }));
  const samSees = textOf(await sam.page(`/phone/${samsCall}`));
  assert.doesNotMatch(samSees, /INV-0041|\$1,200/);
  assert.match(samSees, /Their site https:\/\/elkdiner\.example is down/);
  await sam.post(`/phone/${samsCall}/end`, { outcome: "no-answer" });
});

test("a proposal waiting comes first, and shows its total only to those who see values", async () => {
  const { client } = await wonProject(t.services, mikeyId, { client: "Gormania Feed", title: "Feed store site" });
  const opportunity = unwrap(crm.createOpportunity(t.services.crm, mikeyId, client.id, { title: "Online orders", leadSource: "referral" }));
  const proposalId = "00000000-0000-4000-8000-00000000b001";
  const sentAt = new Date(Date.now() - 6 * 86_400_000).toISOString();
  t.db.prepare("insert into proposal (id, opportunity_id, title, status, pricing, lines, current_version, created_by, created_at, updated_at) values (?, ?, 'Online orders', 'sent', 'fixed', '[]', 1, ?, ?, ?)").run(proposalId, opportunity.id, mikeyId, now(), now());
  t.db.prepare("insert into proposal_version (proposal_id, number, title, pricing, scope, assumptions, exclusions, deliverables, lines, total_minor, currency, minutes, sent_by, sent_at) values (?, 1, 'Online orders', 'fixed', '', '', '', '', '[]', 450000, 'USD', 0, ?, ?)").run(proposalId, mikeyId, sentAt);
  const id = callIn(await mikey.post("/phone", { clientId: client.id }));
  const page = textOf(await mikey.page(`/phone/${id}`));
  assert.match(page, /Proposal follow-up A proposal sent and not answered\./);
  assert.match(page, /Waiting on them The proposal “Online orders” was sent 6 days ago, \$4,500\.00, and isn't answered yet\./);
  await mikey.post(`/phone/${id}/end`, { outcome: "no-answer" });
});

test("guides are changed on their own page, by those who may edit knowledge", async () => {
  assert.match(textOf(await mikey.page("/knowledge")), /the call guides/);
  const page = textOf(await mikey.page("/call-guides"));
  assert.match(page, /Call guides .* First call Used for: A prospect with no proposal yet\. As HQ came\./);
  assert.match(textOf(await sam.page("/call-guides")), /First call Used for: .* What does the business do/, "members read them");
  assert.doesNotMatch(await sam.page("/call-guides"), /Save First call/);
  assert.equal(query(await sam.post("/call-guides", { situation: "renewal", title: "Renewal", questions: "Renew?" }), "problem"), "You don’t have permission to do that.");

  assert.match(query(await mikey.post("/call-guides", { situation: "renewal", title: "", questions: "x" }), "problem"), /Give the guide a name/);
  assert.match(query(await mikey.post("/call-guides", { situation: "renewal", title: "Renewal", questions: "\n\n" }), "problem"), /at least one question/);
  assert.match(query(await mikey.post("/call-guides", { situation: "renewal", title: "Renewal", questions: Array.from({ length: 21 }, (_, i) => `Q${i}`).join("\n") }), "problem"), /up to 20 questions/);
  assert.equal(query(await mikey.post("/call-guides", { situation: "nope", title: "Renewal", questions: "x" }), "problem"), "That record doesn’t exist.");
  const saved = await mikey.post("/call-guides", { situation: "renewal", title: "Renewal time", questions: "1. Still want it?\n2. Paying by card again?" });
  assert.equal(query(saved, "done"), "Saved, with 2 questions. Calls from now on use it.");
  assert.match(textOf(await mikey.page("/call-guides")), /Renewal time Used for: A renewal in the next 30 days\. Changed by Mikey Nichols/);
  const event = t.db.prepare("select context from activity_event where action = 'call-guide.changed'").get()?.["context"] as string;
  assert.deepEqual(JSON.parse(event), { situation: "renewal", title: "Renewal time", questions: 2 });
});

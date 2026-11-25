// Decision 0015 over real HTTP: the hubs in the sidebar, Get HQ ready, and
// (slice 3) the assistant.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AiModel, ChatBlock, ConverseRequest } from "../../src/ai/index.ts";
import { addTodo } from "../../src/todos/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, events, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";
import * as crm from "../../src/crm/index.ts";

let t: TestApp;
let admin: Client;
let member: Client;

/** Claude's stand-in for the assistant: each turn answers with the next blocks queued. */
const queue: ChatBlock[][] = [];
const conversed: ConverseRequest[] = [];
const fake: AiModel = {
  async ask() {
    return { ok: false, problem: "Not used here.", inputCount: 0, outputCount: 0 };
  },
  async converse(request) {
    conversed.push(request);
    const blocks = queue.shift();
    return blocks ? { ok: true, blocks, stopReason: blocks.some((one) => one.type === "tool_use") ? "tool_use" : "end_turn", inputCount: 800, outputCount: 60 } : { ok: false, problem: "Nothing queued.", inputCount: 0, outputCount: 0 };
  },
};
const say = (text: string): ChatBlock => ({ type: "text", text });
let uses = 0;
const use = (name: string, input: Record<string, unknown>): ChatBlock => ({ type: "tool_use", id: `toolu_${++uses}`, name, input });
const query = (res: Response, name: string) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get(name) ?? "";
const actionId = (status: string) => t.db.prepare("select id from assistant_action where status = ? order by created_at desc, rowid desc limit 1").get(status)?.["id"] as string;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, backups: true, ai: fake, builderOwner: "mikey@example.com" });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
});
after(() => t.stop());

test("the sidebar is hubs, with the one you're in open and its page current", async () => {
  const html = await admin.page("/money/profit");
  const nav = html.slice(html.indexOf('<nav class="hq-nav"'), html.indexOf("</nav>"));
  assert.equal((nav.match(/<details open/g) ?? []).length, 1, "one hub open");
  assert.match(nav, /<details open[^>]*>\s*<summary>(<\?zb[^>]*>)*Money/);
  assert.match(nav, /<a href="\/money" aria-current="page">Money<\/a>/, "Profit and loss sits under Money");
  for (const hub of ["Today", "Clients", "Work", "Sites", "Growth", "Company"]) assert.match(nav, new RegExp(`<summary>(<\\?zb[^>]*>)*${hub}`), hub);
  assert.match(nav, /<a class="hq-hub-one" href="\/"[^>]*>Home<\/a>/);
});

test("a member's hubs leave out what they may not open", async () => {
  const html = await member.page("/");
  const nav = html.slice(html.indexOf('<nav class="hq-nav"'), html.indexOf("</nav>"));
  assert.doesNotMatch(nav, /href="\/money"|href="\/activity"|href="\/settings\/ai"/);
  assert.match(nav, /href="\/projects"/);
});

test("Get HQ ready shows admins what's left, worked out from HQ itself", async () => {
  const before = textOf(await admin.page("/"));
  assert.match(before, /Get HQ ready \d of 8 done/);
  assert.match(before, /Nightly backups : not yet Backups are set up\. This ticks itself once the first one has run tonight\./);
  assert.match(before, /Your co-founder : done/, "Sam makes two");
  assert.match(before, /Your clients : not yet/);

  t.db.prepare("insert into client_organization (id, name, status, created_at, updated_at) values ('00000000-0000-4000-8000-0000000000c1', 'Better Days Towing', 'active', '2026-11-25T00:00:00Z', '2026-11-25T00:00:00Z')").run();
  assert.match(textOf(await admin.page("/")), /Your clients : done/);

  assert.doesNotMatch(textOf(await member.page("/")), /Get HQ ready/, "admins only");
});

test("the assistant is off until it's turned on in Settings → AI, and says where", async () => {
  assert.match(textOf(await admin.page("/")), /What needs to happen\? The assistant is off\. Turn on The assistant in AI model and budget/);
  assert.doesNotMatch(textOf(await member.page("/")), /What needs to happen/, "a member isn't told about a switch they can't reach");
  assert.match(query(await admin.post("/assistant", { message: "hello" }), "problem"), /The assistant is off/);
  assert.equal(conversed.length, 0);
});

test("a change waits on a card, and happens as the person on one tap", async () => {
  assert.equal((await admin.post("/settings/ai", { model: "claude-haiku-5-5", "feature-assistant": "on" })).status, 303);
  queue.push([say("I'll add that to-do."), use("quick_add", { line: "Call Stacy about the map tomorrow" })]);
  const sent = await admin.post("/assistant", { message: "add a to-do to call Stacy about the map tomorrow" });
  assert.equal(new URL("http://x" + (sent.headers.get("location") ?? "")).hash, "#chat");
  assert.equal(conversed.length, 1, "a card waits for the person: no second call");
  const request = conversed[0] as ConverseRequest;
  assert.match(request.system, /Mikey Nichols/);
  assert.ok(request.tools.some((tool) => tool.name === "quick_add"));
  assert.equal(t.db.prepare("select count(*) as n from task where title like 'Call Stacy%'").get()?.["n"], 0, "nothing added yet");

  const home = textOf(await admin.page("/"));
  assert.match(home, /You: add a to-do to call Stacy about the map tomorrow/);
  assert.match(home, /Assistant: I'll add that to-do\./);
  assert.match(home, /Waiting for you Add a to-do: “Call Stacy about the map” · Due/);

  const id = actionId("waiting");
  assert.match(query(await member.post(`/assistant/actions/${id}/do`, {}), "problem"), /doesn’t exist/, "someone else's card is not theirs to tap");
  await admin.post(`/assistant/actions/${id}/do`, {});
  assert.equal(t.db.prepare("select count(*) as n from task where title = 'Call Stacy about the map'").get()?.["n"], 1);
  const after = textOf(await admin.page("/"));
  assert.match(after, /Done Add a to-do: “Call Stacy about the map”/);
  assert.match(after, /Done: Add a to-do/);
  assert.match(query(await admin.post(`/assistant/actions/${id}/do`, {}), "problem"), /already done or cancelled/, "once");
  const did = actions(t.db);
  assert.ok(did.includes("todo.added"), "the to-do's own event, as Mikey");
  assert.ok(did.includes("assistant.acted"));
  assert.ok(did.includes("assistant.asked"));
});

test("lookups run straight away and go back to the model; answers link only to HQ's pages", async () => {
  const before = conversed.length;
  queue.push([use("whats_due", {}), use("find", { query: "where do I set my hours" })]);
  queue.push([say("Nothing's due. Set your hours on [Calendar hours](/calls/hours), not [here](https://evil.example).")]);
  await admin.post("/assistant", { message: "what's due, and where are my hours?" });
  assert.equal(conversed.length, before + 2);
  const second = conversed.at(-1) as ConverseRequest;
  const results = second.messages.at(-1)?.content.filter((block) => block.type === "tool_result") ?? [];
  assert.equal(results.length, 2);
  assert.match(JSON.stringify(results), /Calendar hours/);
  const html = await admin.page("/");
  assert.match(html, /<a href="\/calls\/hours">Calendar hours<\/a>/);
  assert.doesNotMatch(html, /href="https:\/\/evil\.example"/);
  assert.match(textOf(html), /Checked what's due/);
});

test("a made-up id or a bad ask goes back to the model as an error, and no card is made", async () => {
  const cards = Number(t.db.prepare("select count(*) as n from assistant_action").get()?.["n"]);
  queue.push([use("tick_off", { todo_id: "not-an-id" }), use("add_note", { on: "client", id: "0f6c2f7e-1b2a-4c3d-8e9f-0a1b2c3d4e5f", note: "Hi" })]);
  queue.push([say("I couldn't find that one.")]);
  await admin.post("/assistant", { message: "tick off the thing" });
  const errors = (conversed.at(-1) as ConverseRequest).messages.at(-1)?.content.filter((block) => block.type === "tool_result" && block.is_error) ?? [];
  assert.equal(errors.length, 2);
  assert.equal(Number(t.db.prepare("select count(*) as n from assistant_action").get()?.["n"]), cards);
});

test("with small changes allowed, a tick-off goes straight through, with Undo", async () => {
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const todo = unwrap(addTodo(t.services.todos, mikey, { title: "Renew the domain" }));
  assert.match(query(await admin.post("/assistant/settings", { autoSmall: "on" }), "done"), /without asking/);
  queue.push([use("tick_off", { todo_id: todo.id })]);
  queue.push([say("Ticked off.")]);
  await admin.post("/assistant", { message: "tick off renew the domain" });
  assert.notEqual(t.services.todos.todos.get(todo.id)?.doneAt ?? null, null, "done without a tap");
  assert.match(textOf(await admin.page("/")), /Done Tick off “Renew the domain” Undo/);
  await admin.post(`/assistant/actions/${actionId("done")}/undo`, {});
  assert.equal(t.services.todos.todos.get(todo.id)?.doneAt ?? null, null, "undone");
  assert.match(textOf(await admin.page("/")), /Undone Tick off “Renew the domain”/);
  await admin.post("/assistant/settings", {});
});

test("cancel, a failed call, usage on the shared budget, and New chat", async () => {
  queue.push([use("add_client", { name: "Elk Diner" })]);
  await admin.post("/assistant", { message: "add Elk Diner as a client" });
  await admin.post(`/assistant/actions/${actionId("waiting")}/cancel`, {});
  assert.match(textOf(await admin.page("/")), /Cancelled Add a client: Elk Diner/);
  assert.equal(t.db.prepare("select count(*) as n from client_organization where name = 'Elk Diner'").get()?.["n"], 0);

  assert.match(query(await admin.post("/assistant", { message: "anything" }), "problem"), /Claude didn’t answer/, "nothing queued: the stand-in fails");
  const usage = t.db.prepare("select count(*) as n, sum(ok) as worked from ai_usage where feature = 'assistant'").get();
  assert.ok(Number(usage?.["n"]) >= 6);
  assert.equal(Number(usage?.["n"]) - Number(usage?.["worked"]), 1, "the failed call is logged and costed too");

  queue.push([use("add_client", { name: "Wolf Armor" })]);
  await admin.post("/assistant", { message: "add Wolf Armor" });
  await admin.post("/assistant/new", {});
  const fresh = textOf(await admin.page("/"));
  assert.doesNotMatch(fresh, /Wolf Armor|Elk Diner/);
  assert.match(fresh, /Do the first one/, "ideas to start with");
  assert.equal(t.db.prepare("select status from assistant_action order by created_at desc, rowid desc limit 1").get()?.["status"], "cancelled", "a card left waiting is cancelled");
});

// ---- Decision 0015, follow-up --------------------------------------------

const mikeyId = () => t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;

test("on another page, the drawer sends with that page's address and comes back to it", async () => {
  const { client } = await wonProject(t.services, mikeyId(), { client: "Better Days Towing", title: "Towing site" });
  const page = textOf(await admin.page(`/clients/${client.id}?chat=open`));
  assert.match(page, /Assistant/);
  assert.match(page, /Good (morning|afternoon|evening), Mikey\./, "the day, from HQ's own records");
  queue.push([say("Noted.")]);
  const sent = await admin.post("/assistant", { message: "what is this client?", from: `/clients/${client.id}` });
  assert.equal(new URL("http://x" + (sent.headers.get("location") ?? "")).pathname, `/clients/${client.id}`);
  assert.match(sent.headers.get("location") ?? "", /chat=open/);
  assert.match((conversed.at(-1) as ConverseRequest).system, new RegExp(`on the page /clients/${client.id}`));
  queue.push([say("Ok.")]);
  await admin.post("/assistant", { message: "hi", from: "https://evil.example/x" });
  assert.doesNotMatch((conversed.at(-1) as ConverseRequest).system, /evil/, "only HQ's own addresses");
});

test("more it can do: a follow-up day with Undo, project health, an invoice draft, a booking link and a proposal", async () => {
  const { opportunity, project } = await wonProject(t.services, mikeyId(), { client: "Elk Diner", title: "Ordering site" });
  const open = unwrap(crm.createOpportunity(t.services.crm, mikeyId(), opportunity.organizationId, { title: "Menu boards", leadSource: "phone", service: "website" }));
  await admin.post("/assistant/settings", { autoSmall: "on" });
  queue.push([use("set_follow_up", { opportunity_id: open.id, on: "2026-12-04" }), use("project_health", { project_id: project.id, health: "at-risk" })]);
  queue.push([say("Done both.")]);
  await admin.post("/assistant", { message: "follow up on menu boards dec 4 and mark the ordering site at risk" });
  assert.equal(t.services.crm.opportunities.get(open.id)?.followUpOn, "2026-12-04");
  assert.equal(t.services.projects.projects.get(project.id)?.health, "at-risk");
  const followUp = t.db.prepare("select id from assistant_action where tool = 'set_follow_up'").get()?.["id"] as string;
  await admin.post(`/assistant/actions/${followUp}/undo`, {});
  assert.equal(t.services.crm.opportunities.get(open.id)?.followUpOn ?? null, null, "back to no follow-up day");
  await admin.post("/assistant/settings", {});

  queue.push([use("stop_timer", {}), use("draft_invoice", { project_id: project.id, kind: "deposit", description: "Deposit: one third", amount: "$500" })]);
  await admin.post("/assistant", { message: "stop my timer and draft the deposit invoice" });
  const results = String(t.db.prepare("select blocks from assistant_message where role = 'user' order by at desc, rowid desc limit 1").get()?.["blocks"]);
  assert.match(results, /"content":"No timer is running\.","is_error":true/, "no timer: told so, no card");
  assert.match(textOf(await admin.page("/")), /Draft an invoice on Ordering site: Deposit: one third, \$500\.00\. It stays a draft/);
  await admin.post(`/assistant/actions/${actionId("waiting")}/do`, {});
  const invoiceId = String(t.db.prepare("select href from assistant_action where tool = 'draft_invoice'").get()?.["href"]).split("/").pop();
  const invoice = t.db.prepare("select status from invoice where id = ?").get(invoiceId ?? "");
  assert.equal(invoice?.["status"], "draft", "drafted, never sent");

  queue.push([use("booking_link", { label: "Stacy at Better Days", lasts: "30", one_time: true })]);
  await admin.post("/assistant", { message: "make Stacy a booking link" });
  await admin.post(`/assistant/actions/${actionId("waiting")}/do`, {});
  const link = t.db.prepare("select token from booking_link order by rowid desc limit 1").get()?.["token"] as string;
  assert.ok(link);
  assert.ok(!JSON.stringify(events(t.db)).includes(link), "the link's key is never in the log");
  assert.ok(!JSON.stringify(t.db.prepare("select * from assistant_action").all()).includes(link), "nor in the conversation");

  queue.push([use("start_proposal", { opportunity_id: open.id })]);
  await admin.post("/assistant", { message: "start a proposal for menu boards" });
  assert.match(textOf(await admin.page("/")), /Start a draft proposal for Menu boards \(Elk Diner\), from the service's template\. Nothing is sent/);
  await admin.post(`/assistant/actions/${actionId("waiting")}/do`, {});
  assert.equal(t.db.prepare("select count(*) as n from proposal where opportunity_id = ?").get(open.id)?.["n"], 1);
});

test("pins: the page you're on, to the top of your sidebar, and back off", async () => {
  const pinned = await admin.post("/nav/pin", { href: "/calls/hours?done=Saved." });
  assert.equal(new URL("http://x" + (pinned.headers.get("location") ?? "")).pathname, "/calls/hours");
  const html = await admin.page("/money");
  assert.match(html, /<summary>(<\?zb[^>]*>)*Pinned/);
  assert.match(html, /<a href="\/calls\/hours">Calendar hours<\/a>/);
  assert.match(textOf(await admin.page("/calls/hours")), /★ Pinned/);
  assert.match(new URL("http://x" + ((await admin.post("/nav/pin", { href: "https://evil.example" })).headers.get("location") ?? "")).searchParams.get("problem") ?? "", /can’t be pinned/);
  assert.match(new URL("http://x" + ((await member.post("/nav/pin", { href: "/activity" })).headers.get("location") ?? "")).searchParams.get("problem") ?? "", /can’t be pinned/, "not a page they may open");
  await admin.post("/nav/pin", { href: "/calls/hours" });
  assert.doesNotMatch(await admin.page("/money"), /Calendar hours<\/a>/);
  assert.deepEqual(actions(t.db).filter((one) => one.startsWith("nav.")), ["nav.pinned", "nav.unpinned"]);
});

test("the command bar finds pages and records as you type, only what the person may see", async () => {
  const found = (await (await admin.get("/find.json?q=elk")).json()) as { items: { kind: string; label: string; href: string }[] };
  assert.ok(found.items.some((one) => one.kind === "Client" && one.label === "Elk Diner"));
  const pages = (await (await admin.get("/find.json?q=invoices")).json()) as { items: { kind: string; label: string }[] };
  assert.equal(pages.items[0]?.kind, "Page");
  const asMember = (await (await member.get("/find.json?q=audit")).json()) as { items: { label: string }[] };
  assert.ok(!asMember.items.some((one) => one.label === "Audit history"));
  const { httpClient } = await import("../support/harness.ts");
  assert.equal((await httpClient(t.origin).get("/find.json?q=elk")).status, 401);
});

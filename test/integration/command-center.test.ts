// Decision 0015 over real HTTP: the hubs in the sidebar, Get HQ ready, and
// (slice 3) the assistant.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AiModel, ChatBlock, ConverseRequest } from "../../src/ai/index.ts";
import { addTodo } from "../../src/todos/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

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
  assert.match(fresh, /What's due today\?/, "ideas to start with");
  assert.equal(t.db.prepare("select status from assistant_action order by created_at desc, rowid desc limit 1").get()?.["status"], "cancelled", "a card left waiting is cancelled");
});

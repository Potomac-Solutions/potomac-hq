import { test } from "node:test";
import assert from "node:assert/strict";
import { historyFor, readAsk, resultText, segmentsOf, systemPrompt, TOOL_NAMES, TOOLS, toolNamed, type Message } from "./assistant.ts";

const ID = "0f6c2f7e-1b2a-4c3d-8e9f-0a1b2c3d4e5f";

test("every tool is named once, with a kind and a schema", () => {
  assert.deepEqual(TOOLS.map((tool) => tool.name), [...TOOL_NAMES]);
  for (const tool of TOOLS) {
    assert.ok(["look", "small", "change"].includes(tool.kind), tool.name);
    assert.equal(tool.input_schema["type"], "object");
  }
  assert.equal(toolNamed("tick_off")?.kind, "small");
  assert.equal(toolNamed("add_client")?.kind, "change");
  assert.equal(toolNamed("rm_rf"), null);
});

test("what the model asks for is read and checked, and a bad ask says why", () => {
  assert.deepEqual(readAsk("find", { query: "  Better Days " }), { ok: true, value: { tool: "find", query: "Better Days" } });
  assert.deepEqual(readAsk("move_task", { task_id: ID.toUpperCase(), to: "doing" }), { ok: true, value: { tool: "move_task", taskId: ID, to: "doing" } });
  assert.equal(readAsk("move_task", { task_id: "task-1", to: "doing" }).ok, false, "an id must be an id");
  assert.equal(readAsk("move_task", { task_id: ID, to: "archived" }).ok, false);
  assert.equal(readAsk("add_note", { on: "invoice", id: ID, note: "x" }).ok, false);
  assert.equal(readAsk("quick_add", { line: "" }).ok, false);
  assert.deepEqual(readAsk("log_contact", { opportunity_id: ID, client_id: ID, kind: "call" }), { ok: true, value: { tool: "log_contact", clientId: "", opportunityId: ID, kind: "call", outcome: "reached", note: "", followUpOn: "" } });
  assert.equal(readAsk("log_contact", { kind: "call" }).ok, false, "on someone");
  assert.equal(readAsk("log_contact", { client_id: ID, kind: "email", follow_up_on: "Friday" }).ok, false);
  assert.equal(readAsk("open_deal", { client_id: ID, title: "Site", lead_source: "carrier pigeon" }).ok, false);
  assert.deepEqual(readAsk("open_deal", { client_id: ID, title: "Site", lead_source: "referral", service: "nope" }), { ok: true, value: { tool: "open_deal", clientId: ID, title: "Site", leadSource: "referral", service: "", summary: "" } });
  const unknown = readAsk("delete_everything", {});
  assert.equal(unknown.ok ? "" : unknown.error, "There is no tool called delete_everything.");
  assert.equal(readAsk("find", { query: 42 }).ok, false, "only text is read");
});

const said = (role: Message["role"], text: string): Message => ({ role, content: [{ type: "text", text }] });

test("history starts at something the person typed and keeps the newest messages", () => {
  const messages: Message[] = [said("user", "one"), said("assistant", "two"), { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "{}" }] }, said("assistant", "three"), said("user", "four"), said("assistant", "five")];
  assert.deepEqual(historyFor(messages, 4).map((message) => message.role), ["user", "assistant"], "a lone tool result is never first");
  assert.equal(historyFor(messages, 20).length, 6);
});

test("history joins neighbours from the same side, and answers a tool use left without a result", () => {
  const messages: Message[] = [
    said("user", "add a to-do"),
    { role: "assistant", content: [{ type: "text", text: "Here." }, { type: "tool_use", id: "tu_1", name: "quick_add", input: { line: "x" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "Shown as a card." }] },
    said("user", "thanks"),
    { role: "assistant", content: [{ type: "tool_use", id: "tu_2", name: "find", input: { query: "x" } }] },
  ];
  const history = historyFor(messages);
  assert.deepEqual(history.map((message) => message.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.deepEqual(history[2]?.content.map((block) => block.type), ["tool_result", "text"], "results first, then what was typed");
  assert.deepEqual(history[4]?.content, [{ type: "tool_result", tool_use_id: "tu_2", content: "Not done.", is_error: true }]);
});

test("only links to HQ's own pages become links", () => {
  assert.deepEqual(segmentsOf("Set them on [Calendar hours](/calls/hours), then [Google](https://google.com) or [x](//evil.example)."), [
    { text: "Set them on ", href: "" },
    { text: "Calendar hours", href: "/calls/hours" },
    { text: ", then [Google](https://google.com) or [x](//evil.example).", href: "" },
  ]);
  assert.deepEqual(segmentsOf("No links."), [{ text: "No links.", href: "" }]);
  assert.deepEqual(segmentsOf("[javascript](javascript:alert(1))"), [{ text: "[javascript](javascript:alert(1))", href: "" }]);
});

test("a long result is cut, and says so", () => {
  const long = resultText({ rows: "x".repeat(10_000) });
  assert.ok(long.length <= 6000);
  assert.match(long, /cut short/);
});

test("the system prompt says who, when, and how changes are confirmed", () => {
  const asking = systemPrompt({ name: "Mikey Nichols", today: "Wednesday, November 25, 2026", autoSmall: false });
  assert.match(asking, /Mikey Nichols/);
  assert.match(asking, /November 25, 2026/);
  assert.match(asking, /card with a Do it button\./);
  assert.match(systemPrompt({ name: "M", today: "x", autoSmall: true }), /straight through with an Undo/);
});

test("the follow-up tools are read and checked too", async () => {
  const { readWhere } = await import("./assistant.ts");
  assert.deepEqual(readAsk("set_follow_up", { opportunity_id: ID, on: "" }), { ok: true, value: { tool: "set_follow_up", opportunityId: ID, on: "" } });
  assert.equal(readAsk("set_follow_up", { opportunity_id: ID, on: "next week" }).ok, false);
  assert.equal(readAsk("project_health", { project_id: ID, health: "great" }).ok, false);
  assert.deepEqual(readAsk("booking_link", { label: "Stacy", lasts: "30", one_time: true }), { ok: true, value: { tool: "booking_link", label: "Stacy", lasts: "30", oneTime: true } });
  assert.equal(readAsk("booking_link", { label: "Stacy", lasts: "365" }).ok, false);
  assert.deepEqual(readAsk("draft_invoice", { project_id: ID, kind: "deposit", description: "Deposit", amount: "$1,500.50" }), { ok: true, value: { tool: "draft_invoice", projectId: ID, kind: "deposit", description: "Deposit", amount: "1500.50", dueOn: "" } });
  assert.deepEqual(readAsk("draft_invoice", { project_id: ID, kind: "full", description: "All", amount: 250 }).ok, true, "a number is read as dollars");
  for (const amount of ["0", "-5", "lots", "1.234"]) assert.equal(readAsk("draft_invoice", { project_id: ID, kind: "full", description: "x", amount }).ok, false, amount);
  assert.equal(readWhere("/clients/abc?x=1#top"), "/clients/abc?x=1");
  for (const bad of ["https://evil.example", "//evil.example", "/assistant", "javascript:alert(1)", "/" + "x".repeat(300)]) assert.equal(readWhere(bad), "", bad);
  assert.match(systemPrompt({ name: "M", today: "x", autoSmall: false, where: "/clients/abc" }), /on the page \/clients\/abc/);
});

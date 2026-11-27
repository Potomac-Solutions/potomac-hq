// Decision 0021 over real HTTP: starting a company project from the Projects
// page, its overview with no client panels, and the company board showing
// its tasks and everyone's to-dos.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { idIn, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
});
after(() => t.stop());

test("an admin starts a company project from the Projects page; it has no client, money or portal panels", async () => {
  assert.match(await admin.page("/projects"), /Start a company project/);
  assert.doesNotMatch(await member.page("/projects"), /Start a company project/);

  const refused = await member.post("/projects", { name: "Training", kind: "ongoing" });
  assert.match(decodeURIComponent(refused.headers.get("location") ?? ""), /permission/);

  const made = await admin.post("/projects", { name: "Training and certifications", kind: "ongoing", description: "Cloud and commerce." });
  const location = made.headers.get("location") ?? "";
  assert.match(location, /^\/projects\/[0-9a-f-]{36}\?done=/);
  const id = idIn(location);

  const page = await admin.page(`/projects/${id}`);
  assert.match(page, /<h1>Training and certifications<\/h1>/);
  assert.match(textOf(page), /Company work: Potomac’s own, with no client/);
  assert.doesNotMatch(page, /href="\/projects\/[0-9a-f-]{36}\/money"/);
  assert.doesNotMatch(page, /id="project-deliverables"/);
  assert.doesNotMatch(page, /id="project-updates"/);
  assert.doesNotMatch(page, /The client has to do this one/);
  assert.doesNotMatch(page, /href="\/clients\//);

  assert.match(await admin.page("/projects"), /Company work/);

  await admin.post(`/projects/${id}/tasks`, { title: "AWS Solutions Architect", priority: "normal" });
  await admin.post("/todos", { title: "Call the accountant" });
  const board = textOf(await admin.page("/board"));
  assert.match(board, /AWS Solutions Architect/);
  assert.match(board, /Call the accountant/);
  assert.match(board, /everyone’s to-dos/);
});

// Comments and files on tasks (decision 0007, section 6) against a real
// database and over real HTTP.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { PDF, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let samId: Id;
let task: Id;
const problemOf = (location: string | null) => new URL("http://x" + (location ?? "")).searchParams.get("problem") ?? "";
const events = (action: string) => (t.db.prepare("select context from activity_event where action = ? order by rowid").all(action) as { context: string }[]).map((row) => JSON.parse(row.context) as Record<string, unknown>);

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  samId = t.db.prepare("select id from user where email = 'sam@example.com'").get()?.["id"] as Id;
  const { project } = await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" });
  task = unwrap(projects.addTask(t.services.projects, mikeyId, project.id, { title: "Send the homepage proof" })).id;
});
after(() => t.stop());

test("anyone who sees a task comments on it; mentions of real people stand out and are recorded", async () => {
  const added = await sam.submit(`/tasks/${task}/comments`, { body: "Proof is ready. @mikey can you send it to dale@example.com? @nobody" });
  assert.match(added.location, /^\/tasks\/[0-9a-f-]{36}\?done=[^#]*#comment-[0-9a-f-]{36}$|^\/tasks\/[0-9a-f-]{36}#comment-/);
  assert.match(added.html, /Comment added\./);
  assert.match(added.html, /<strong class="mention">@mikey<\/strong>/);
  assert.doesNotMatch(added.html, /<strong class="mention">@nobody/);
  assert.match(textOf(added.html), /Sam Rivers .* Proof is ready\./);
  assert.deepEqual(events("comment.added").at(-1)?.["mentions"], [mikeyId]);

  const refused = await sam.post(`/tasks/${task}/comments`, { body: "   " });
  assert.match(problemOf(refused.headers.get("location")), /Write something first/);
});

test("only the author edits or deletes a comment, even over an admin; every version stays in the history", async () => {
  const id = t.db.prepare("select id from task_comment where author_id = ?").get(samId)?.["id"] as Id;
  const asMikey = await mikey.page(`/tasks/${task}`);
  assert.doesNotMatch(asMikey, new RegExp(`action="/comments/${id}"`), "Mikey isn't offered Sam's edit form");
  assert.match(problemOf((await mikey.post(`/comments/${id}`, { body: "Hijacked", taskId: task })).headers.get("location")), /permission/);
  assert.match(problemOf((await mikey.post(`/comments/${id}/remove`, { taskId: task })).headers.get("location")), /permission/);

  const edited = await sam.submit(`/comments/${id}`, { body: "Proof is ready. @Sam-Rivers will send it.", taskId: task });
  assert.match(edited.html, /Comment saved\./);
  assert.match(textOf(edited.html), /\(edited [^)]+\)/);
  assert.match(problemOf((await sam.post(`/comments/${id}`, { body: "Proof is ready. @Sam-Rivers will send it.", taskId: task })).headers.get("location")), /Nothing changed/);
  const change = events("comment.edited").at(-1);
  assert.match(String(change?.["was"]), /@mikey can you send it/);
  assert.deepEqual(change?.["mentions"], [samId], "only people newly mentioned");

  const gone = await sam.submit(`/comments/${id}/remove`, { taskId: task });
  assert.match(gone.html, /Comment deleted\./);
  assert.match(gone.html, /No comments yet\./);
  assert.equal(t.db.prepare("select count(*) as n from task_comment").get()?.["n"], 0);
  assert.match(String(events("comment.removed").at(-1)?.["was"]), /@Sam-Rivers will send it/);
});

test("files attach to a task with the deliverable rules, and download with file.download", async () => {
  const sent = await mikey.upload(`/tasks/${task}/files`, {}, { field: "file", name: "homepage-proof.pdf", bytes: PDF, type: "application/pdf" });
  assert.equal(sent.status, 303);
  const { html: page } = await mikey.follow(sent, `/tasks/${task}/files`);
  assert.match(page, /File attached\./);
  const href = /<a href="(\/files\/[0-9a-f-]{36})">homepage-proof\.pdf<\/a>/.exec(page)?.[1];
  assert.ok(href);
  const record = t.db.prepare("select owner_type, owner_id, organization_id from file where name = 'homepage-proof.pdf'").get() as Record<string, unknown>;
  assert.equal(record["owner_type"], "task");
  assert.equal(record["owner_id"], task);
  assert.notEqual(record["organization_id"], null, "filed under the project's client");

  const download = await sam.get(href);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /attachment/);

  const bad = await mikey.upload(`/tasks/${task}/files`, {}, { field: "file", name: "run-me.exe", bytes: new Uint8Array([77, 90]), type: "application/octet-stream" });
  assert.match(problemOf(bad.headers.get("location")), /can’t be uploaded/);
  assert.match(textOf(await mikey.page(`/tasks/${task}`)), /homepage-proof\.pdf \d+ bytes Mikey Nichols, /);
});

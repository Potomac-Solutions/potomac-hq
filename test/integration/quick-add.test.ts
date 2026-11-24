// Quick add (decision 0007, section 4) against a real database and over real
// HTTP: one line becomes a project task or a to-do, with its labels; a part
// that means no one, or more than one, stops the save until it is removed.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, httpClient, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let samId: Id;
let websiteId: Id;
const today = () => Temporal.Now.plainDateISO("America/New_York");
const task = (title: string) => t.db.prepare("select * from task where title = ?").get(title) as Record<string, unknown> | undefined;
const labelsOf = (id: unknown) => (t.db.prepare("select l.name from task_label tl join label l on l.id = tl.label_id where tl.task_id = ? order by l.name").all(id as string) as { name: string }[]).map((row) => row.name);

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await signIn(t, "samantha@example.com", "Samantha Lee", ["member"]);
  await signIn(t, "sam.ortiz@example.com", "Sam Ortiz", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  samId = t.db.prepare("select id from user where email = 'sam@example.com'").get()?.["id"] as Id;
  await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" });
  await wonProject(t.services, mikeyId, { client: "Tailgate Farms", title: "Tailgate shop" });
  websiteId = unwrap(projects.addLabel(t.services.projects, mikeyId, { name: "Website", colour: "blue" })).id;
});
after(() => t.stop());

test("a whole line: a project task for someone, with a priority, a date and labels, one of them new", async () => {
  const preview = await mikey.page("/add?text=" + encodeURIComponent("Send the homepage proof +better-days @sam-rivers !high *website *Proofs tomorrow"));
  assert.match(preview, /<h2>A task, called<\/h2>/);
  assert.match(preview, /<p class="quick-title">Send the homepage proof<\/p>/);
  const said = textOf(preview);
  for (const part of ["In Better Days website (Better Days Towing)", "For Sam Rivers", "High priority", "Label Website", "New label Proofs", "Due "]) assert.ok(said.includes(part), part);

  const added = await mikey.submit("/add", { text: "Send the homepage proof +better-days @sam-rivers !high *website *Proofs tomorrow", skip: "" });
  assert.match(added.location, /^\/add\?added=[0-9a-f-]{36}&done=/);
  assert.match(added.html, /Added\. <a href="\/tasks\/[0-9a-f-]{36}"[^>]*>Open it<\/a>/);
  const row = task("Send the homepage proof");
  assert.ok(row);
  assert.equal(row["assignee_id"], samId);
  assert.equal(row["priority"], "high");
  assert.equal(row["due_on"], today().add({ days: 1 }).toString());
  assert.equal(row["created_by"], mikeyId);
  assert.notEqual(row["project_id"], null);
  assert.deepEqual(labelsOf(row["id"]), ["Proofs", "Website"]);
  for (const action of ["task.added", "label.added", "task.labelled"]) assert.ok(actions(t.db).includes(action), action);
});

test("a client gives a to-do about them; with no one named, it's the adder's", async () => {
  await mikey.submit("/add", { text: "Ask about the spring menu +tailgate-farms by 12/5", skip: "" });
  const row = task("Ask about the spring menu");
  assert.ok(row);
  assert.equal(row["project_id"], null);
  assert.equal(row["assignee_id"], mikeyId);
  assert.equal(row["organization_id"], t.db.prepare("select id from client_organization where name = 'Tailgate Farms'").get()?.["id"]);
  assert.match(String(row["due_on"]), /^\d{4}-12-05$/);
  assert.ok(actions(t.db).includes("todo.added"));
  assert.match(await mikey.page("/todos"), /Ask about the spring menu/);
});

test("a project task with no one named is no one's yet, as on the project page", async () => {
  await mikey.submit("/add", { text: "Order the yard sign +tailgate", skip: "" });
  assert.equal(task("Order the yard sign")?.["assignee_id"], null);
});

test("@sam is Sam, not Samantha; but with two Sams, the part stops the save; keeping it in the title lets it through", async () => {
  const text = "Call @sam about towing";
  const preview = await mikey.page("/add?text=" + encodeURIComponent(text));
  assert.match(textOf(preview), /@sam could be Sam Ortiz or Sam Rivers\./);
  assert.doesNotMatch(preview, />Add it</);
  const refused = await mikey.submit("/add", { text, skip: "" });
  assert.match(refused.html, /matches no one, or more than one/);
  assert.match(refused.location, /^\/add\?text=Call\+%40sam\+about\+towing&problem=/);

  const keep = /<a href="([^"]+)" aria-label="Keep in title: @sam">/.exec(preview)?.[1]?.replaceAll("&amp;", "&");
  assert.equal(keep, "/add?text=Call+%40sam+about+towing&skip=1");
  const kept = await mikey.page(keep);
  assert.match(kept, /<p class="quick-title">Call @sam about towing<\/p>/);
  assert.match(kept, /<input type="hidden" name="skip" value="1">/);
  await mikey.submit("/add", { text, skip: "1" });
  assert.equal(task("Call @sam about towing")?.["assignee_id"], mikeyId);
});

test("unknown projects and people, and a line with nothing left for the title, are explained", async () => {
  assert.match(textOf(await mikey.page("/add?text=" + encodeURIComponent("Fix it +nowhere"))), /No open project or client goes by \+nowhere\./);
  assert.match(textOf(await mikey.page("/add?text=" + encodeURIComponent("Fix it @nobody"))), /No one here goes by @nobody\./);
  const empty = await mikey.page("/add?text=" + encodeURIComponent("tomorrow !high"));
  assert.match(empty, /Add some words for the title/);
  const refused = await mikey.submit("/add", { text: "tomorrow !high", skip: "" });
  assert.match(refused.html, /Enter a title\./);
  assert.equal(labelsOf(websiteId).length, 0);
});

test("the box in the top bar, and who may use it", async () => {
  const today = await sam.page("/today");
  assert.match(today, /<form method="get" action="\/add" class="hq-quick">/);
  assert.match(today, /aria-keyshortcuts="n"/);
  assert.doesNotMatch(await sam.page("/add"), /class="hq-quick"/, "the page has its own box");
  const outsider = httpClient(t.origin);
  const res = await outsider.post("/add", { text: "Sneaky +better-days" });
  assert.equal(task("Sneaky"), undefined);
  assert.notEqual(res.status, 200);
});

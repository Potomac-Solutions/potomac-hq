// "How did we do?" (2026-11-26): asked once a project is finished. Low is
// private and makes a to-do to call; high leads on to the review.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
const said = (res: Response, name: "done" | "problem") => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get(name) ?? "";
const where = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).pathname;

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

async function finished(client: string) {
  const won = await wonProject(t.services, mikey, { client, title: `${client} website` });
  const person = await clientSignedIn(t, admin, won.client.id, `${client} Owner`, `${client.toLowerCase().replace(/\W/g, "")}@example.com`);
  return { won, person };
}

test("not asked while a project is open; asked once it's finished; a 5 goes on to the review", async () => {
  const { won, person } = await finished("Elk Diner");
  assert.doesNotMatch(textOf(await person.page("/portal")), /Rate a finished project/);
  unwrap(projects.setProjectStatus(t.services.projects, mikey, won.project.id, "completed"));
  assert.match(textOf(await person.page("/portal")), /Rate a finished project[\s\S]*“Elk Diner website” is finished\. How did it go\?/);
  const given = await person.post(`/portal/projects/${won.project.id}/feedback`, { score: "5", note: "So easy." });
  assert.equal(where(given), "/portal/review");
  assert.match(said(given, "done"), /Would you say a few words in a review\?/);
  assert.doesNotMatch(textOf(await person.page("/portal")), /Rate a finished project/);
  assert.equal(said(await person.post(`/portal/projects/${won.project.id}/feedback`, { score: "4" }), "problem"), "You’ve already told us about that one. Thank you.");
  assert.match(textOf(await admin.page(`/projects/${won.project.id}`)), /How the client rated it 5 of 5, great ?, from Elk Diner Owner[\s\S]*“So easy\.”/);
});

test("a 2 stays private and makes a to-do for whoever ran it", async () => {
  const { won, person } = await finished("Moats Hardware");
  unwrap(projects.setProjectStatus(t.services.projects, mikey, won.project.id, "completed"));
  const given = await person.post(`/portal/projects/${won.project.id}/feedback`, { score: "2", note: "Took longer than we were told." });
  assert.equal(where(given), "/portal");
  assert.equal(said(given, "done"), "Thank you for telling us. Someone will be in touch to hear more.");
  const todo = t.db.prepare("select title, description, assignee_id, organization_id from task where title like 'Call Moats Hardware%'").get();
  assert.equal(todo?.["assignee_id"], mikey);
  assert.equal(todo?.["organization_id"], won.client.id);
  assert.match(String(todo?.["description"]), /rated it 2 of 5 \(Not great\)\.\n\n“Took longer than we were told\.”/);
  assert.match(textOf(await admin.page(`/projects/${won.project.id}`)), /A to-do to call them went to whoever ran the project\./);
});

test("not for an open project, nor someone else's, nor a made-up score", async () => {
  const { won, person } = await finished("Hillside Farm");
  const other = await finished("Nu-Finish Collision");
  unwrap(projects.setProjectStatus(t.services.projects, mikey, other.won.project.id, "completed"));
  assert.equal(said(await person.post(`/portal/projects/${won.project.id}/feedback`, { score: "5" }), "problem"), "That project isn’t here.");
  assert.equal(said(await person.post(`/portal/projects/${other.won.project.id}/feedback`, { score: "5" }), "problem"), "That project isn’t here.");
  assert.equal(said(await other.person.post(`/portal/projects/${other.won.project.id}/feedback`, { score: "7" }), "problem"), "Pick one of the five.");
});

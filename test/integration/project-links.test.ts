// Project links over real HTTP: added on the project, shared ones shown in
// the client's portal, Potomac-only ones kept out of it, and removed.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Id } from "../../src/shared/index.ts";
import { actions, clientSignedIn, signIn, testApp, textOf, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let client: Client;
let projectId: Id;
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const me = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const won = await wonProject(t.services, me, { client: "Elk Diner" });
  projectId = won.project.id;
  client = await clientSignedIn(t, admin, won.client.id, "Rita Okafor", "rita@example.com");
});
after(() => t.stop());

test("links are added with https:// filled in; a bad address is refused", async () => {
  assert.match(textOf(await admin.page(`/projects/${projectId}`)), /Links Where the work lives/);
  assert.equal(problemOf(await admin.post(`/projects/${projectId}/links`, { kind: "staging", url: "not a site" })), "Enter a web address, like staging.example.com.");
  await admin.post(`/projects/${projectId}/links`, { kind: "staging", url: "staging.elkdiner.com", shared: "1" });
  await admin.post(`/projects/${projectId}/links`, { kind: "design", label: "Menu mock-ups", url: "https://figma.com/file/abc", shared: "1" });
  await admin.post(`/projects/${projectId}/links`, { kind: "repository", url: "github.com/Potomac-Solutions/elk-diner" });
  const page = textOf(await admin.page(`/projects/${projectId}`));
  assert.match(page, /Staging site \(opens in a new tab\) staging\.elkdiner\.com · In the portal/);
  assert.match(page, /Menu mock-ups \(opens in a new tab\) figma\.com · Designs · In the portal/);
  assert.match(page, /Code repository \(opens in a new tab\) github\.com · Potomac only/);
  assert.ok(actions(t.db).includes("project.link-added"));
});

test("the client sees only the shared links, under Where to see the work", async () => {
  const page = textOf(await client.page(`/portal/projects/${projectId}`));
  assert.match(page, /Where to see the work Staging site \(opens in a new tab\) staging\.elkdiner\.com Menu mock-ups \(opens in a new tab\) figma\.com/);
  assert.doesNotMatch(page, /github|repository/i);
});

test("a link can be removed", async () => {
  const id = t.db.prepare("select id from project_link where kind = 'staging'").get()?.["id"] as string;
  await admin.post(`/project-links/${id}/remove`, {});
  assert.doesNotMatch(textOf(await client.page(`/portal/projects/${projectId}`)), /staging\.elkdiner/);
  assert.ok(actions(t.db).includes("project.link-removed"));
});

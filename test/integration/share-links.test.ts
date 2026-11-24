// Sharing a project by link (decision 0007, section 11) against a real
// database and over real HTTP, the visitor with no account at all.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { addNote } from "../../src/notes/index.ts";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, httpClient, PDF, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let samId: Id;
let website: Id;
let homepage: Id;
let shared: Id;
let draft: Id;
let seeLink = "";
let commentLink = "";
const day = (days: number) => Temporal.Now.plainDateISO("America/New_York").add({ days }).toString();
const visitor = () => httpClient(t.origin);
const linkIn = (html: string) => new URL(/<input readonly value="([^"]+)">/.exec(html)?.[1] ?? "http://x/none").pathname;
const make = async (fields: Record<string, string>) => {
  const res = await mikey.post(`/projects/${website}/shares`, fields);
  return { status: res.status, html: await res.text(), headers: res.headers };
};

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  samId = t.db.prepare("select id from user where email = 'sam@example.com'").get()?.["id"] as Id;
  const deps = t.services.projects;
  website = (await wonProject(t.services, mikeyId, { client: "Better Days Towing", title: "Better Days website" })).project.id;
  const design = unwrap(projects.addPhase(deps, mikeyId, website, { name: "Design" }));
  homepage = unwrap(projects.addTask(deps, mikeyId, website, { title: "Build the homepage", phaseId: design.id, assigneeId: samId, dueOn: day(5), estimate: "6", description: "Internal: reuse the old hero code." })).id;
  unwrap(projects.addMilestone(deps, mikeyId, website, { name: "Dale signs off the design", phaseId: design.id, dueOn: day(7) }));
  const proof = unwrap(projects.addDeliverable(deps, mikeyId, website, { title: "Homepage mockup", file: { name: "mockup.pdf", bytes: PDF } }));
  unwrap(projects.setDeliverableShared(deps, mikeyId, proof.id, true));
  shared = proof.fileId;
  draft = unwrap(projects.addDeliverable(deps, mikeyId, website, { title: "Rough sketches", file: { name: "sketches.pdf", bytes: PDF } })).fileId;
  unwrap(addNote(t.services.notes, mikeyId, { recordType: "project", recordId: website, body: "Dale is slow to pay; ask for a deposit." }));
  unwrap(projects.addTaskComment(deps, samId, homepage, "Internal: hero photo is blurry."));
});
after(() => t.stop());

test("admins and managers make links; the link is shown once and only its hash kept", async () => {
  assert.doesNotMatch(await sam.page(`/projects/${website}`), /Share by link/);
  assert.equal((await sam.post(`/projects/${website}/shares`, { label: "Dale", rights: "see" })).status, 303);
  assert.equal(t.db.prepare("select count(*) as n from project_share").get()?.["n"], 0, "a member can't");

  const refused = await mikey.post(`/projects/${website}/shares`, { label: "Dale", rights: "see", expiresOn: day(-1) });
  assert.match(new URL("http://x" + (refused.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /a last day from today on/);

  const see = await make({ label: "Dale at Better Days", rights: "see", expiresOn: day(30) });
  assert.equal(see.status, 200);
  assert.equal(see.headers.get("cache-control"), "no-store");
  assert.match(see.html, /<h1>A link for Dale at Better Days<\/h1>/);
  seeLink = linkIn(see.html);
  assert.match(seeLink, /^\/s\/[A-Za-z0-9_-]{43}$/);
  commentLink = linkIn((await make({ label: "Dale, with comments", rights: "comment" })).html);
  const token = seeLink.slice(3);
  assert.doesNotMatch(JSON.stringify(t.db.prepare("select * from project_share").all()), new RegExp(token));

  const page = textOf(await mikey.page(`/projects/${website}`));
  assert.match(page, /Share by link .*Dale at Better Days See Through [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+ Not opened yet Mikey Nichols/);
  assert.match(page, /Dale, with comments See and comment Until stopped/);
  assert.ok(actions(t.db).includes("project.share-made"));
});

test("a visitor sees the plan, tasks and shared deliverables, and nothing internal", async () => {
  const res = await visitor().get(seeLink);
  assert.equal(res.status, 200);
  const html = await res.text();
  const page = textOf(html);
  for (const seen of ["Shared by Potomac Solutions with Dale at Better Days", "Better Days website", "Design", "Milestone: Dale signs off the design", "Build the homepage", "To do", "Homepage mockup"]) assert.ok(page.includes(seen), seen);
  for (const hidden of ["Sam Rivers", "reuse the old hero code", "deposit", "hero photo is blurry", "Rough sketches", "6 hours", "Comment on"]) assert.ok(!page.includes(hidden), hidden);
  assert.doesNotMatch(html, /hq-side|Sign out/, "no HQ navigation for a visitor");
  assert.equal(t.db.prepare("select visits from project_share where label = 'Dale at Better Days'").get()?.["visits"], 1);
  assert.ok(actions(t.db).includes("project.share-visited"));
  assert.match(textOf(await mikey.page(`/projects/${website}`)), /Dale at Better Days See Through .* 1 visit, last /);
});

test("files: a shared deliverable downloads through the link; a draft, or anything else, doesn't", async () => {
  const file = await visitor().get(`${seeLink}/files/${shared}`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-disposition") ?? "", /attachment; filename="mockup\.pdf"/);
  assert.equal((await visitor().get(`${seeLink}/files/${draft}`)).status, 404);
  const other = (await wonProject(t.services, mikeyId, { client: "Tailgate Farms", title: "Tailgate shop" })).project.id;
  const theirs = unwrap(projects.addDeliverable(t.services.projects, mikeyId, other, { title: "Their logo", file: { name: "logo.pdf", bytes: PDF } }));
  unwrap(projects.setDeliverableShared(t.services.projects, mikeyId, theirs.id, true));
  assert.equal((await visitor().get(`${seeLink}/files/${theirs.fileId}`)).status, 404, "another project's file");
  assert.equal((await visitor().get(`/files/${shared}`)).status, 404, "HQ's own file address still needs an account");
});

test("comments: only through a link that may, under the visitor's name, seen by the team marked as from the link", async () => {
  const blocked = await visitor().post(`${seeLink}/tasks/${homepage}/comments`, { name: "Dale", body: "Looks good" });
  assert.match(new URL("http://x" + (blocked.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /not comment on it/);

  const page = await visitor().get(commentLink);
  assert.match(await page.text(), /Comment on “Build the homepage”/);
  const noName = await visitor().post(`${commentLink}/tasks/${homepage}/comments`, { name: " ", body: "Hello" });
  assert.match(new URL("http://x" + (noName.headers.get("location") ?? "")).searchParams.get("problem") ?? "", /Enter your name/);
  const sent = await visitor().post(`${commentLink}/tasks/${homepage}/comments`, { name: "Dale Ortiz", body: "Can the phone number be bigger?" });
  assert.match(sent.headers.get("location") ?? "", new RegExp(`^/s/[A-Za-z0-9_-]{43}\\?done=.*#task-${homepage}$`));

  const after = textOf(await (await visitor().get(commentLink)).text());
  assert.match(after, /Dale Ortiz .* Can the phone number be bigger\?/);
  assert.doesNotMatch(after, /hero photo is blurry/, "the team's own comments stay internal");

  const staff = await mikey.page(`/tasks/${homepage}`);
  assert.match(textOf(staff), /Dale Ortiz Through the share link “Dale, with comments” .* Can the phone number be bigger\?/);
  const commentId = t.db.prepare("select id from task_comment where guest_name = 'Dale Ortiz'").get()?.["id"] as Id;
  assert.doesNotMatch(await sam.page(`/tasks/${homepage}`), new RegExp(`/comments/${commentId}/remove`), "a member can't remove it");
  assert.match(staff, new RegExp(`/comments/${commentId}/remove`));
  assert.equal(t.db.prepare("select count(*) as n from notice where kind = 'mentioned'").get()?.["n"], 0);
  const gone = await mikey.submit(`/comments/${commentId}/remove`, { taskId: homepage });
  assert.match(gone.html, /Comment deleted\./);
});

test("a stopped, expired or made-up link is not found, for pages, comments and files", async () => {
  const id = t.db.prepare("select id from project_share where label = 'Dale at Better Days'").get()?.["id"] as Id;
  const stopped = await mikey.submit(`/shares/${id}/stop`, { projectId: website });
  assert.match(stopped.html, /The link “Dale at Better Days” has stopped working\./);
  assert.match(textOf(stopped.html), /Dale at Better Days See Stopped/);
  assert.equal((await visitor().get(seeLink)).status, 404);
  assert.equal((await visitor().get(`${seeLink}/files/${shared}`)).status, 404);
  assert.ok(actions(t.db).includes("project.share-stopped"));

  t.db.prepare("update project_share set expires_on = ? where label = 'Dale, with comments'").run(day(-1));
  assert.equal((await visitor().get(commentLink)).status, 404);
  assert.equal((await visitor().post(`${commentLink}/tasks/${homepage}/comments`, { name: "Dale", body: "Hi" })).status, 404);
  assert.equal((await visitor().get(`/s/${"a".repeat(43)}`)).status, 404);
  assert.equal((await visitor().get("/s/short")).status, 404);
});

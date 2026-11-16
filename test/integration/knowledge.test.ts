// v1.0: the knowledge base over real HTTP. Filled from HQ's own documents,
// searched, written, edited with revisions kept, and archived.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { readDocuments } from "../../src/knowledge/adapters.ts";
import { seedKnowledge } from "../../src/knowledge/index.ts";
import { count, events, signIn, TEST_PASSWORD_COST, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
const docs = join(import.meta.dirname, "..", "..", "docs");
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  member = await signIn(t, "sam@example.com", "Sam Helper", ["member"]);
  await member.get("/");
});
after(() => t.stop());

test("HQ's own documents are put in once, and never over an edit", async () => {
  const documents = readDocuments(docs);
  assert.ok(documents.length >= 9, `found ${documents.length} documents`);
  const first = seedKnowledge(t.services.knowledge, documents);
  assert.deepEqual(first.skipped, []);
  assert.equal(first.added.length, documents.length);
  assert.ok(first.added.includes("workflow") && first.added.includes("decision-0001-stack"));
  assert.deepEqual(seedKnowledge(t.services.knowledge, documents), { added: [], skipped: [] });
  assert.equal(events(t.db).filter((e) => e.action === "knowledge.seeded").length, 1);

  const page = await member.page("/knowledge");
  assert.match(page, new RegExp(`<h2 id="kb-results">${documents.length} results</h2>`));
  assert.match(page, /href="\/knowledge\/workflow"/);
  const log = textOf(await member.page("/knowledge?kind=decision"));
  assert.match(log, /2 results/);
  assert.match(log, /Decision .* Decisions · Decided 2026-11-\d\d/);

  // A real document renders as headings, tables and lists, with no Markdown marks left in tables.
  const matrix = await member.page("/knowledge/authorization-matrix");
  assert.match(matrix, /<h1>Authorization matrix[^<]*<\/h1>/i);
  assert.match(matrix, /<th scope="col">Permission key<\/th>/);
  assert.match(matrix, /<td>client\.view<\/td>/);
  assert.match(textOf(matrix), /Revision 1 Current Potomac HQ,/);
});

test("search finds words in the title, text and tags, and treats % and _ as written", async () => {
  assert.match(textOf(await member.page("/knowledge?q=append-only")), /Data model/i);
  assert.match(textOf(await member.page("/knowledge?q=zzzz-nothing")), /0 results Nothing found Try other words/);
  assert.match(textOf(await member.page("/knowledge?q=%25")), /^(?!.*\b1[0-9] results).*$/s, "a % is not a wildcard");
  assert.match(textOf(await member.page("/knowledge?tag=roles")), /Tagged “roles”\. 1 result Authorization matrix/);
  assert.match(textOf(await member.page("/knowledge?category=Decisions")), /2 results/);
});

test("an article is written, edited with every revision kept, and archived", async () => {
  assert.equal(problemOf(await admin.post("/knowledge", { kind: "article", title: "", category: "Operations", tags: "", body: "x" })), "Give it a title.");
  const made = await admin.submit("/knowledge", { kind: "article", title: "Restore drill", category: "Operations", tags: "Backups, railway", body: "# When\n\nEvery quarter.\n\n- Run `npm run restore:drill`\n- Read <b>the report</b>" });
  assert.match(made.location, /^\/knowledge\/restore-drill\?/);
  assert.match(made.html, /<h2>When<\/h2>/);
  assert.match(made.html, /<li>Run npm run restore:drill<\/li>/);
  assert.match(made.html, /&lt;b&gt;the report&lt;\/b&gt;/, "HTML in a body is shown as text");
  const id = t.db.prepare("select id from article where slug = 'restore-drill'").get()?.["id"] as string;

  // The same title again gets its own address.
  const twin = await admin.submit("/knowledge", { kind: "article", title: "Restore drill", category: "Operations", tags: "", body: "Another." });
  assert.match(twin.location, /^\/knowledge\/restore-drill-2\?/);

  assert.equal(problemOf(await admin.post(`/articles/${id}`, { slug: "restore-drill", title: "Restore drill", category: "Operations", tags: "railway, backups", body: "# When\n\nEvery quarter.\n\n- Run `npm run restore:drill`\n- Read <b>the report</b>" })), "Nothing was changed.");
  const edited = await admin.submit(`/articles/${id}`, { slug: "restore-drill", title: "Restore drill", category: "Operations", tags: "backups", body: "Every month now." });
  assert.match(edited.html, /Saved as a new revision\./);
  assert.match(textOf(edited.html), /Revision 2 Current Mikey Nichols, .* Revision 1 Mikey Nichols,/);
  const old = await member.page("/knowledge/restore-drill/revisions/1");
  assert.match(old, /Every quarter\./);
  assert.match(old, /This is an older revision/);
  assert.equal((await member.get("/knowledge/restore-drill/revisions/9")).status, 404);
  assert.equal((await member.get("/knowledge/no-such-article")).status, 404);
  assert.throws(() => t.db.prepare("update article_revision set body = 'x'").run(), /written once/);

  const archived = await admin.submit(`/articles/${id}/archive`, { slug: "restore-drill", archived: "1" });
  assert.match(archived.html, /This is archived/);
  assert.doesNotMatch(await member.page("/knowledge?q=Every+month"), /restore-drill"/);
  assert.match(await member.page("/knowledge?q=Every+month&archived=1"), /href="\/knowledge\/restore-drill"/);
  assert.match(problemOf(await admin.post(`/articles/${id}`, { slug: "restore-drill", title: "T", category: "C", tags: "", body: "B" })), /archived/);
  await admin.submit(`/articles/${id}/archive`, { slug: "restore-drill", archived: "0" });
  assert.deepEqual(events(t.db).filter((e) => e.record === id).map((e) => e.action), ["article.created", "article.edited", "article.archived", "article.restored"]);
});

test("a decision is logged with its day", async () => {
  assert.match(problemOf(await admin.post("/knowledge", { kind: "decision", title: "Use Brevo", category: "Decisions", tags: "", body: "Because.", decidedOn: "2099-01-01" })), /today or earlier/);
  const made = await admin.submit("/knowledge", { kind: "decision", title: "Use Brevo for email", category: "Decisions", tags: "email", body: "It has a free tier and an API.", decidedOn: "2026-11-10" });
  assert.match(textOf(made.html), /Decision · Decisions · Decided 2026-11-10 · Revision 1 · email/);
  assert.match(textOf(await member.page("/knowledge?kind=decision")), /3 results/);
  assert.equal(events(t.db).at(-1)?.action, "decision.recorded");
});

test("a member reads everything and writes nothing", async () => {
  const page = await member.page("/knowledge/restore-drill");
  assert.doesNotMatch(page, /Change it|Save as a new revision|Archive it/);
  assert.doesNotMatch(await member.page("/knowledge"), /Write something down/);
  const before = count(t.db, "article_revision");
  const id = t.db.prepare("select id from article where slug = 'restore-drill'").get()?.["id"] as string;
  assert.match(problemOf(await member.post("/knowledge", { kind: "article", title: "T", category: "C", tags: "", body: "B" })), /permission/);
  assert.match(problemOf(await member.post(`/articles/${id}`, { slug: "restore-drill", title: "T", category: "C", tags: "", body: "B" })), /permission/);
  assert.match(problemOf(await member.post(`/articles/${id}/archive`, { slug: "restore-drill", archived: "1" })), /permission/);
  assert.equal(count(t.db, "article_revision"), before);
});

// The portal, second pass: steps that are the client's to do, pictures shown
// on the page, Potomac hearing when a client acts, and clients hearing when
// something is waiting.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as finance from "../../src/finance/index.ts";
import * as portal from "../../src/portal/index.ts";
import * as projects from "../../src/projects/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, PDF, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let mikey: Id;
let dale: Client;
let clientId = "";
let projectId = "";
const problemOf = (res: Response) => new URL(t.origin + (res.headers.get("location") ?? "")).searchParams.get("problem") ?? "";
const day = (n: number) => Temporal.PlainDate.from(t.services.today()).add({ days: n }).toString();
// The smallest file that is a PNG by its first bytes.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const sent: { to: string; subject: string; body: string }[] = [];
const mail: portal.Mail = async (message) => (sent.push({ ...message }), true);
const options = { publicUrl: "https://hq.example", toClients: false, phone: "304-555-0142" };
/** Everything already in the log is treated as read, the way it is when notices are first turned on. */
const caughtUp = () => t.services.portal.events.setCursor(Number(t.db.prepare("select coalesce(max(rowid), 0) as n from activity_event").get()?.["n"]), t.services.portal.clock());

before(async () => {
  t = await testApp({
    passwordCost: TEST_PASSWORD_COST,
    clientNotices: true,
    // Email is "set up" but refuses to send, so invite links are shown and the test can use them.
    email: { publicUrl: "https://hq.example", send: async () => ({ error: "test" }) },
  });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const made = await wonProject(t.services, mikey, { client: "Hinkle Family Farm", title: "Farm stand website" });
  clientId = made.client.id;
  projectId = made.project.id;
  dale = await clientSignedIn(t, admin, clientId, "Dale Hinkle", "dale@hinklefarm.example");
});
after(() => t.stop());

test("a step can be the client's to do, and their portal then lists it as waiting on them", async () => {
  const added = await admin.submit(`/projects/${projectId}/milestones`, { name: "Photos and prices from you", dueOn: day(-2), forClient: "1" });
  assert.match(added.html, /Milestone added\./);
  assert.match(textOf(added.html), /Photos and prices from you Client’s to do/);
  await admin.submit(`/projects/${projectId}/milestones`, { name: "Design signed off", dueOn: day(5) });

  const home = textOf(await dale.page("/portal"));
  assert.match(home, /1 thing is waiting on you Your turn: Photos and prices from you Farm stand website\. It was due [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}\. Send it/);
  assert.doesNotMatch(home, /Your turn: Design signed off/);
  assert.match(textOf(await dale.page(`/portal/projects/${projectId}`)), /Photos and prices from you Yours to do \(not done yet\) Was due .* Design signed off \(not done yet\)/);

  // Potomac can take it back, give it again, and marking it done clears it.
  const id = t.db.prepare("select id from milestone where for_client = 1").get()?.["id"] as string;
  await admin.submit(`/milestones/${id}/for-client`, { forClient: "0", projectId });
  assert.match(textOf(await dale.page("/portal")), /Nothing is waiting on you/);
  assert.equal(problemOf(await admin.post(`/milestones/${id}/for-client`, { forClient: "0", projectId })), "Nothing changed.");
  await admin.submit(`/milestones/${id}/for-client`, { forClient: "1", projectId });
  assert.match(textOf(await dale.page("/portal")), /Your turn: Photos and prices from you/);
  await admin.submit(`/milestones/${id}/done`, { done: "1", projectId });
  assert.match(textOf(await dale.page("/portal")), /Nothing is waiting on you/);
  assert.deepEqual(events(t.db).filter((e) => /^milestone\.(given|taken)/.test(e.action)).map((e) => e.action), ["milestone.taken-back", "milestone.given-to-client"]);
});

test("a picture shared with the client is shown on the page, and a PDF is a button", async () => {
  const picture = unwrap(projects.addDeliverable(t.services.projects, mikey, projectId as Id, { title: "Home page design", file: { name: "home.png", bytes: PNG } }));
  const paper = unwrap(projects.addDeliverable(t.services.projects, mikey, projectId as Id, { title: "Price sheet", file: { name: "prices.pdf", bytes: PDF } }));
  for (const made of [picture, paper]) unwrap(projects.setDeliverableShared(t.services.projects, mikey, made.id, true));
  const page = await dale.page(`/portal/projects/${projectId}`);
  assert.match(page, new RegExp(`<img class="portal-preview" src="/portal/files/${picture.fileId}" alt="Home page design" loading="lazy">`));
  assert.equal((page.match(/<img class="portal-preview"/g) ?? []).length, 1);
  const image = await dale.get(`/portal/files/${picture.fileId}`);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
});

test("the dashboard shows what clients did, and each line goes to the place", async () => {
  await dale.submit("/portal/messages", { projectId, body: "When do we launch?" });
  await dale.upload(`/portal/projects/${projectId}/files`, {}, { field: "file", name: "stand.png", bytes: PNG });
  const picture = t.db.prepare("select id from deliverable where title = 'Home page design'").get()?.["id"] as string;
  await dale.submit(`/portal/deliverables/${picture}/decision`, { decision: "changes-requested", note: "Bigger sign", projectId });
  await dale.submit("/portal/calls", { wanted: "After dark" });
  const html = await admin.page("/");
  const page = textOf(html);
  assert.match(page, /From your clients .* Dale Hinkle \(Hinkle Family Farm\) asked for a call .* Dale Hinkle \(Hinkle Family Farm\) asked for changes to a deliverable on Farm stand website .* Dale Hinkle \(Hinkle Family Farm\) sent a file on Farm stand website .* Dale Hinkle \(Hinkle Family Farm\) sent a message on Farm stand website/);
  assert.match(html, new RegExp(`href="/projects/${projectId}#client-files"`));
  assert.match(html, new RegExp(`href="/clients/${clientId}#portal"`));
  assert.doesNotMatch(page, /signed in to the portal.*From your clients|From your clients.*downloaded/, "sign-ins and downloads are not news");
});

test("Potomac is emailed when a client acts: one email for a run, to whoever owns the work", async () => {
  sent.length = 0;
  const first = await portal.sendNotices(t.services.portal, mail, options);
  assert.equal(first.toStaff, 1);
  assert.equal(first.toClients, 0, "clients are not emailed unless that is turned on");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.to, "mikey@example.com");
  assert.equal(sent[0]?.subject, "4 things from clients in Potomac HQ");
  assert.match(sent[0]?.body ?? "", /- Dale Hinkle \(Hinkle Family Farm\) sent a message on Farm stand website\.\n {2}https:\/\/hq\.example\/projects\/[0-9a-f-]{36}#updates/);
  assert.match(sent[0]?.body ?? "", /asked for a call\.\n {2}https:\/\/hq\.example\/clients\/[0-9a-f-]{36}#portal/);
  assert.doesNotMatch(sent[0]?.body ?? "", /When do we launch|Bigger sign|After dark/, "what the client wrote stays in HQ");

  // Nothing new: nothing sent, and nothing sent twice.
  assert.deepEqual(await portal.sendNotices(t.services.portal, mail, options), { read: 1, toStaff: 0, toClients: 0, failed: 0 });
  assert.deepEqual(await portal.sendNotices(t.services.portal, mail, options), { read: 0, toStaff: 0, toClients: 0, failed: 0 });
  assert.equal(sent.length, 1);

  // One thing reads as one sentence, and goes to the project's owner, not every admin.
  await signIn(t, "pat@example.com", "Pat Admin", ["admin"]);
  await dale.submit("/portal/messages", { projectId, body: "One more thing" });
  await portal.sendNotices(t.services.portal, mail, options);
  assert.deepEqual(sent.slice(1).map((m) => [m.to, m.subject]), [["mikey@example.com", "Dale Hinkle sent a message on Farm stand website"]]);
  // A call request has no owner, so every admin hears.
  await dale.submit("/portal/calls", { wanted: "Sunday" });
  await portal.sendNotices(t.services.portal, mail, options);
  assert.deepEqual(sent.slice(2).map((m) => m.to).sort(), ["mikey@example.com", "pat@example.com"]);
  assert.deepEqual(events(t.db).filter((e) => e.action === "notice.sent").at(-1)?.context, { toStaff: 2, toClients: 0, failed: 0 });
});

test("a client is emailed that something is waiting, once per run, with nothing private in it", async () => {
  caughtUp();
  sent.length = 0;
  const deliverable = unwrap(projects.addDeliverable(t.services.projects, mikey, projectId as Id, { title: "Second design", file: { name: "two.pdf", bytes: PDF } }));
  unwrap(projects.setDeliverableShared(t.services.projects, mikey, deliverable.id, true));
  const invoice = unwrap(finance.createInvoice(t.services.finance, mikey, projectId as Id, { kind: "deposit", description: "Deposit", amount: "800" }));
  unwrap(finance.sendInvoiceNow(t.services.finance, mikey, invoice.id));
  unwrap(portal.postProjectUpdate(t.services.portal, mikey, projectId as Id, "The second design is up. It costs nothing extra."));
  unwrap(portal.postProjectUpdate(t.services.portal, mikey, projectId as Id, "And one more note."));

  const run = await portal.sendNotices(t.services.portal, mail, { ...options, toClients: true });
  assert.deepEqual([run.toStaff, run.toClients, run.failed], [0, 1, 0]);
  assert.deepEqual([sent[0]?.to, sent[0]?.subject], ["dale@hinklefarm.example", "Something new from Potomac Solutions"]);
  const body = sent[0]?.body ?? "";
  assert.match(body, /Hi Dale Hinkle,\n\nThere is something new for Hinkle Family Farm in your client portal:\n\n- Something for you to look at and approve\n- An invoice\n- An update on your project\n\nSign in to see it:\nhttps:\/\/hq\.example\/portal\n\nRather talk\? Call 304-555-0142\./);
  assert.match(body, /To stop these emails, sign in and turn them off at the bottom of the page\./);
  assert.doesNotMatch(body, /800|Second design|costs nothing|INV-/, "no amount, title or message leaves the portal");

  // A second person at the client gets their own. Someone turned off, or not yet signed in, gets none.
  const carol = await clientSignedIn(t, admin, clientId, "Carol Hinkle", "carol@hinklefarm.example");
  await admin.post(`/clients/${clientId}/portal-users`, { name: "Not Yet", email: "notyet@hinklefarm.example" });
  caughtUp();
  sent.length = 0;
  unwrap(portal.postProjectUpdate(t.services.portal, mikey, projectId as Id, "Third note."));
  await portal.sendNotices(t.services.portal, mail, { ...options, toClients: true });
  assert.deepEqual(sent.map((m) => m.to).sort(), ["carol@hinklefarm.example", "dale@hinklefarm.example"]);

  // Carol turns hers off from the portal. Only hers.
  const page = await carol.page("/portal");
  assert.match(textOf(page), /Emails from this portal You get an email when something is waiting for you here\. .* Stop these emails/);
  assert.match((await carol.submit("/portal/notices", { on: "0" })).html, /You are not emailed when something is waiting\./);
  sent.length = 0;
  unwrap(portal.postProjectUpdate(t.services.portal, mikey, projectId as Id, "Fourth note."));
  await portal.sendNotices(t.services.portal, mail, { ...options, toClients: true });
  assert.deepEqual(sent.map((m) => m.to), ["dale@hinklefarm.example"]);
  assert.match((await carol.submit("/portal/notices", { on: "1" })).html, /Stop these emails/);
});

test("an email that fails is counted, does not stop the others, and is not tried again", async () => {
  caughtUp();
  const tried: string[] = [];
  const flaky: portal.Mail = async (message) => {
    tried.push(message.to);
    if (message.to.startsWith("carol")) throw new Error("brevo is down");
    return !message.to.startsWith("dale");
  };
  unwrap(portal.postProjectUpdate(t.services.portal, mikey, projectId as Id, "Fifth note."));
  await dale.submit("/portal/messages", { projectId, body: "Got it" });
  const run = await portal.sendNotices(t.services.portal, flaky, { ...options, toClients: true });
  assert.deepEqual([run.toStaff, run.toClients, run.failed], [1, 0, 2]);
  assert.deepEqual(tried.sort(), ["carol@hinklefarm.example", "dale@hinklefarm.example", "mikey@example.com"]);
  assert.equal((await portal.sendNotices(t.services.portal, flaky, { ...options, toClients: true })).toClients, 0);
  assert.equal(tried.length, 3, "two emails about one thing is the worse mistake");
});

test("with client notices off, the portal offers no email switch", async () => {
  const quiet = await testApp({ passwordCost: TEST_PASSWORD_COST });
  try {
    const boss = await signIn(quiet, "mikey@example.com", "Mikey Nichols", ["admin"]);
    await boss.get("/");
    const id = quiet.db.prepare("select id from user").get()?.["id"] as Id;
    const made = await wonProject(quiet.services, id);
    const ann = await clientSignedIn(quiet, boss, made.client.id, "Ann Baker", "ann@bakery.example");
    assert.doesNotMatch(await ann.page("/portal"), /Emails from this portal/);
    assert.doesNotMatch(await boss.page("/"), /From your clients/, "nothing to show until a client does something");
  } finally {
    await quiet.stop();
  }
});

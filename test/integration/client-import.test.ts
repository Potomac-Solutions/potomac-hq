// Importing clients over real HTTP: a pasted CSV becomes clients, their
// contacts and their projects, all or nothing; demo clients are marked and
// kept out of the figures.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actions, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
const where = (res: Response) => res.headers.get("location") ?? "";
const problemOf = (res: Response) => new URL(t.origin + where(res)).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + where(res)).searchParams.get("done") ?? "";
const n = (table: string) => Number(t.db.prepare(`select count(*) as n from ${table}`).get()?.["n"]);

const LIST = `Client,Contact,Phone,Email,Website,Project,Service,Pricing,Price,Repository,Live,Demo
Elk Diner,"Dana ""Dee"" Reyes",+13045550142,dana@elkdiner.example,https://elkdiner.example,Website,website,fixed,"1,500",https://github.com/example/elk-diner,https://elkdiner.example,no
Mt. Storm Bakery,Sam Ortiz,304-555-0100,,,,,,,,,
Hickory Hollow Bakehouse,,,,,Counter,application,free,,https://github.com/example/counter,,yes
Lakeside Paddle & Pedal,,,,,Outfitter,application,free,,https://github.com/example/outfitter,,yes`;

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await admin.get("/");
  await member.get("/");
});
after(() => t.stop());

test("only someone who could add them all by hand can import", async () => {
  assert.match(textOf(await admin.page("/clients")), /Clients Import clients/);
  assert.ok(!textOf(await member.page("/clients")).includes("Import clients"));
  assert.equal((await member.get("/clients/import")).status, 403);
  assert.equal(problemOf(await member.post("/clients/import", { rows: LIST })), "You don’t have permission to import clients.");
  assert.equal(n("client_organization"), 0);
  const page = textOf(await admin.page("/clients/import"));
  assert.match(page, /Import clients Paste your clients .* Clients, as CSV Import Cancel The columns/);
});

test("one bad line saves nothing, and says which line and why", async () => {
  const bad = LIST.replace("Mt. Storm Bakery,Sam Ortiz,304-555-0100", "Mt. Storm Bakery,Sam Ortiz,call me");
  assert.equal(problemOf(await admin.post("/clients/import", { rows: bad })), "Line 3: the phone number isn’t one: like 301-555-0142 or +13015550142. Nothing was imported.");
  assert.equal(problemOf(await admin.post("/clients/import", { rows: LIST.replace(",https://elkdiner.example,no", ",not a site,no") })), "Line 2: the live site isn’t a web address starting with https://. Nothing was imported.");
  assert.equal(problemOf(await admin.post("/clients/import", { rows: "Client,Shoe size\nA,9" })), "“Shoe size” isn’t a column HQ knows. The columns are listed under the box.");
  assert.equal(problemOf(await admin.post("/clients/import", { rows: "Client,Project\nA,Site" })), "Line 2: a project needs its pricing: free, fixed, hourly, monthly or yearly. Nothing was imported.");
  for (const table of ["client_organization", "contact", "opportunity", "project", "project_link", "activity_event where action like 'client.%'"]) assert.equal(n(table), 0, table);
});

test("a good list becomes clients, contacts, won projects and links, through the same steps as by hand", async () => {
  const done = await admin.post("/clients/import", { rows: LIST });
  assert.equal(doneOf(done), "Imported 4 clients with 3 projects. 2 are demos.");
  assert.equal(where(done).split("?")[0], "/clients");

  const diner = t.db.prepare("select id, status, website, demo from client_organization where name = 'Elk Diner'").get();
  assert.deepEqual({ status: diner?.["status"], website: diner?.["website"], demo: diner?.["demo"] }, { status: "active", website: "https://elkdiner.example/", demo: 0 });
  assert.deepEqual({ ...t.db.prepare("select name, phone, email, is_primary from contact where organization_id = ?").get(diner?.["id"] as string) }, { name: 'Dana "Dee" Reyes', phone: "+13045550142", email: "dana@elkdiner.example", is_primary: 1 });
  const won = t.db.prepare("select title, stage, service, pricing, value_minor from opportunity where organization_id = ?").get(diner?.["id"] as string);
  assert.deepEqual({ ...won }, { title: "Website", stage: "won", service: "website", pricing: "fixed", value_minor: 150000 });
  const project = t.db.prepare("select id, name, status from project where organization_id = ?").get(diner?.["id"] as string);
  assert.equal(project?.["status"], "active");
  assert.deepEqual(t.db.prepare("select kind, url, shared from project_link where project_id = ? order by kind").all(project?.["id"] as string).map((row) => ({ ...row })), [
    { kind: "live", url: "https://elkdiner.example/", shared: 1 },
    { kind: "repository", url: "https://github.com/example/elk-diner", shared: 0 },
  ]);
  // A client with no project stays a prospect.
  assert.equal(t.db.prepare("select status from client_organization where name = 'Mt. Storm Bakery'").get()?.["status"], "prospective");
  // The same history as by hand, and one line for the import.
  const did = actions(t.db);
  for (const action of ["client.created", "contact.created", "opportunity.created", "opportunity.value-set", "opportunity.stage-changed", "client.status-changed", "opportunity.converted", "project.created", "project.link-added"]) assert.ok(did.includes(action), action);
  assert.equal(did.at(-1), "client.imported");
});

test("pasting the same list again adds nothing; a longer list adds only what's new", async () => {
  assert.equal(problemOf(await admin.post("/clients/import", { rows: LIST })), "Every client there is already in HQ (4), so nothing was added.");
  assert.equal(doneOf(await admin.post("/clients/import", { rows: `${LIST}\nShowroom Demo,,,,,Showroom,application,free,,,,yes` })), "Imported 1 client with 1 project. 1 is a demo. Skipped 4 clients already in HQ: Elk Diner, Mt. Storm Bakery, Hickory Hollow Bakehouse, Lakeside Paddle & Pedal.");
  assert.equal(n("client_organization"), 5);
});

test("demo clients carry a badge and stay out of the figures and reports", async () => {
  const list = await admin.page("/clients?kind=demo");
  assert.match(textOf(list), /Lakeside Paddle & Pedal Demo Active .* Hickory Hollow Bakehouse Demo Active/);
  assert.ok(!textOf(list).includes("Elk Diner"));
  assert.ok(!textOf(await admin.page("/clients?kind=real")).includes("Hickory Hollow"));
  const demoId = t.db.prepare("select id from client_organization where name = 'Hickory Hollow Bakehouse'").get()?.["id"] as string;
  assert.match(textOf(await admin.page(`/clients/${demoId}`)), /Hickory Hollow Bakehouse Demo Active/);
  assert.match(textOf(await admin.page("/projects")), /Counter Demo/);

  // The dashboard counts one active project: Elk Diner's. The three demos' aren't real work.
  assert.match(textOf(await admin.page("/")), /Projects active 1 /);
  const reports = textOf(await admin.page("/reports"));
  assert.match(reports, /Won 1 Lost 0/, "the demos' wins aren't counted");
  assert.match(reports, /Project health Active 1 Completed/);
  assert.match(reports, /Budget against actual Project .* Website 0 h/);
  assert.ok(!/Counter 0 h|Outfitter 0 h/.test(reports), "nor their budgets");

  // Marking one real brings it back into the figures; and back again.
  assert.equal(doneOf(await admin.post(`/clients/${demoId}/demo`, { demo: "0" })), "Saved.");
  assert.match(textOf(await admin.page("/")), /Projects active 2 /);
  // Whoever can change a client's status can say whether it's a demo: members too.
  assert.equal(doneOf(await member.post(`/clients/${demoId}/demo`, { demo: "1" })), "Saved.");
  assert.equal(actions(t.db).at(-1), "client.demo-changed");
  assert.match(textOf(await admin.page("/")), /Projects active 1 /);
});

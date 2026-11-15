// The first slice over real HTTP: the forms post, the pages show the result,
// and what a member is sent never contains a price.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp, type App } from "../../src/app.ts";
import { createHqStaff } from "../../src/identity/adapters.ts";
import { migrate, newId, openDatabase, readMigrations, systemClock, type Database } from "../../src/shared/adapters.ts";

const PASSWORD = "correct horse battery";
let dir: string;
let db: Database;
let app: App;
let server: Server;
let origin: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "hq-crm-pages-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db, readMigrations(join(import.meta.dirname, "..", "..", "migrations")), systemClock);
  app = await createApp({ db, secure: false, proxies: 0, noticeSecret: "crm-secret-crm-secret-crm-secret-0000", attemptsPerMinute: 1000 });
  server = createServer(app.listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The page as rendered, without Zubra's hydration markers. */
function visible(html: string): string {
  return html.replace(/<\?zb[^>]*\?>/g, "");
}

function browser() {
  let cookie = "";
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(origin + path, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers as Record<string, string> | undefined), ...(cookie ? { cookie } : {}) },
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const pair = set.split(";")[0] ?? "";
      cookie = pair.endsWith("=") ? "" : pair;
    }
    return res;
  }
  const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = { origin }) =>
    request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString() });
  return {
    get: (path: string) => request(path),
    post,
    /** Posts, follows the redirect, and returns the page and where it landed. */
    async submit(path: string, fields: Record<string, string>): Promise<{ location: string; html: string }> {
      const res = await post(path, fields);
      assert.equal(res.status, 303, `${path}: ${await res.text()}`);
      const location = res.headers.get("location") ?? "";
      return { location, html: visible(await (await request(location)).text()) };
    },
  };
}

async function signIn(email: string, name: string, roles: string[]) {
  const b = browser();
  const setup = await app.setupPath();
  if (setup) {
    const token = new URL(origin + setup).searchParams.get("token") ?? "";
    assert.equal((await b.post("/staff/accept", { token, email, name, password: PASSWORD })).status, 303);
    return b;
  }
  // A second person: made through the kit, then given an HQ user with these roles.
  const staff = createHqStaff(db, { secure: false });
  const owner = staff.list().find((one) => one.roles.includes("owner"));
  assert.ok(owner);
  const invite = await (staff as unknown as { invite(by: unknown, who: unknown): Promise<{ token: string }> }).invite(owner, { email, name, roles: ["staff"] });
  assert.equal((await b.post("/staff/accept", { token: invite.token, name, password: PASSWORD })).status, 303);
  const account = staff.list().find((one) => one.email === email);
  assert.ok(account);
  const id = newId();
  db.prepare("insert into user (id, staff_account, name, email, status, created_at, updated_at) values (?, ?, ?, ?, 'active', 'now', 'now')").run(id, account.account, name, email);
  for (const role of roles) db.prepare("insert into user_role (user_id, role_id) select ?, id from role where key = ?").run(id, role);
  return b;
}

let admin: ReturnType<typeof browser>;
let clientPath = "";
let opportunityPath = "";

test("an admin runs the slice through the pages", async () => {
  admin = await signIn("mikey@example.com", "Mikey Nichols", ["admin"]);
  const today = Temporal.Now.plainDateISO("America/New_York").toString();

  const list = visible(await (await admin.get("/clients")).text());
  assert.match(list, /No clients yet/);

  const created = await admin.submit("/clients", { name: "Mt. Storm Bakery", sizeTier: "small", website: "mtstormbakery.com", phone: "", address: "" });
  clientPath = created.location.split("?")[0] ?? "";
  assert.match(clientPath, /^\/clients\/[0-9a-f-]{36}$/);
  assert.match(created.html, /<h1>Mt\. Storm Bakery<\/h1>/);
  assert.match(created.html, /Client added\./);
  assert.match(created.html, /https:\/\/mtstormbakery\.com\//);

  const contact = await admin.submit(`${clientPath}/contacts`, { name: "Ann Baker", email: "ann@example.com", phone: "", title: "Owner", isPrimary: "on" });
  assert.match(contact.html, /Ann Baker <span class="hq-tag">Primary<\/span>/);
  const contactId = /<option value="([0-9a-f-]{36})">Ann Baker<\/option>/.exec(contact.html)?.[1];
  assert.ok(contactId, "the contact is offered when opening an opportunity");

  const opened = await admin.submit(`${clientPath}/opportunities`, { title: "Bakery website", service: "website", leadSource: "word-of-mouth", contactId, summary: "Wants online orders." });
  opportunityPath = opened.location.split("?")[0] ?? "";
  assert.match(opportunityPath, /^\/opportunities\/[0-9a-f-]{36}$/);
  assert.match(opened.html, /<strong>New<\/strong>/);
  assert.match(opened.html, /Move to Consult booked/);

  const followed = await admin.submit(`${opportunityPath}/follow-up`, { on: today });
  assert.match(followed.html, /class="hq-tag due">Due</);
  assert.match(visible(await (await admin.get("/")).text()), new RegExp(`Bakery website</a> · Mt\\. Storm Bakery`), "the dashboard lists the follow-up on its day");

  await admin.submit(`${opportunityPath}/stage`, { to: "consult-booked" });
  await admin.submit(`${opportunityPath}/stage`, { to: "consulted" });
  const refused = await admin.submit(`${opportunityPath}/stage`, { to: "quoted" });
  assert.match(refused.html, /This needs a price first/);

  const priced = await admin.submit(`${opportunityPath}/value`, { pricing: "monthly", amount: "50" });
  assert.match(priced.html, /\$50\.00 a month/);
  await admin.submit(`${opportunityPath}/stage`, { to: "quoted" });
  const won = await admin.submit(`${opportunityPath}/stage`, { to: "won" });
  assert.match(won.html, /<strong>Won<\/strong>/);
  assert.match(won.html, /Start the project/);
  assert.doesNotMatch(won.html, /Follow-ups due/);

  const project = await admin.submit(`${opportunityPath}/convert`, {});
  assert.match(project.location, /^\/projects\/[0-9a-f-]{36}\?/);
  assert.match(project.html, /<h1>Bakery website<\/h1>/);
  assert.match(project.html, /Ongoing plan/);
  assert.match(project.html, /Project started\./);

  const clientPage = visible(await (await admin.get(clientPath)).text());
  assert.match(clientPage, /<dt>Status<\/dt><dd>Active<\/dd>/, "winning made the client active");
  assert.match(visible(await (await admin.get("/")).text()), /Mikey Nichols started a project/);
});

test("a member sees the deal but never its price, and cannot set one", async () => {
  const member = await signIn("hire@example.com", "New Hire", ["member"]);
  const page = visible(await (await member.get(opportunityPath)).text());
  assert.match(page, /<h1>Bakery website<\/h1>/);
  assert.doesNotMatch(page, /\$50|50\.00|a month|Price/);
  assert.doesNotMatch(await (await member.get(clientPath)).text(), /\$50|a month/);

  const tried = await member.submit(`${opportunityPath}/value`, { pricing: "fixed", amount: "9" });
  assert.match(tried.html, /You don’t have permission to do that\./);
  const count = db.prepare("select count(*) as n from activity_event where action = 'opportunity.value-set'").get()?.["n"];
  assert.equal(count, 1, "only the admin's price was recorded");
});

test("posts from another site, without a form, or too large are refused before anything runs", async () => {
  const before = db.prepare("select count(*) as n from client_organization").get()?.["n"];
  const fields = { name: "Planted by another site" };
  for (const headers of [{ origin: "https://evil.example" }, { origin: "null" }, {}]) {
    const res = await admin.post("/clients", fields, headers as Record<string, string>);
    assert.equal(res.status, 403, JSON.stringify(headers));
  }
  const json = await fetch(origin + "/clients", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
  assert.equal(json.status, 415);
  const big = await admin.post("/clients", { name: "x".repeat(20_000) });
  assert.equal(big.status, 413);
  assert.equal(db.prepare("select count(*) as n from client_organization").get()?.["n"], before);
});

test("signed out, every CRM page is the sign-in form and every post is refused", async () => {
  const stranger = browser();
  for (const path of ["/clients", clientPath, opportunityPath]) {
    const res = await stranger.get(path);
    assert.equal(res.status, 401, path);
    assert.match(await res.text(), /action="\/staff\/sign-in"/);
  }
  const tried = await stranger.submit("/clients", { name: "Sneaky" });
  assert.match(tried.html, /action="\/staff\/sign-in"/);
  assert.equal(db.prepare("select count(*) as n from client_organization where name = 'Sneaky'").get()?.["n"], 0);
});

test("an address that is not a record is the 404 page", async () => {
  for (const path of ["/clients/not-an-id", `/clients/${newId()}`, `/opportunities/${newId()}`, `/projects/${newId()}`]) {
    const res = await admin.get(path);
    assert.equal(res.status, 404, path);
    assert.match(await res.text(), /There is no page at this address/);
  }
  const missing = await admin.submit(`/opportunities/${newId()}/stage`, { to: "won" });
  assert.match(missing.html, /That record doesn’t exist\./);
});

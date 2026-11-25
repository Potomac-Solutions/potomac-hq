// Lead sources (decision 0010, slice 3) over real HTTP: the inquiry form from
// the website and HQ's own page, and the website's booking, keep where the
// person was; the opportunity shows it; the report counts each source's
// leads, calls, proposals and wins; and only those with report.view see it.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import { issueSiteToken } from "../../src/public-site/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { httpClient, signIn, TEST_PASSWORD_COST, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

const SITE = "https://potomac.solutions";
let t: TestApp;
let mikey: Client;
let sam: Client;
let mikeyId: Id;
let token = "";
const allWeek = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((day) => [[`start-${day}-0`, "00:00"], [`end-${day}-0`, "23:00"]]));
const opportunityOf = (title: string) => t.db.prepare("select id from opportunity where title like ?").get(`%${title}%`)?.["id"] as Id;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST, formOrigins: [SITE], publicUrl: "https://hq.example", email: { publicUrl: "https://hq.example", send: async () => ({ ok: true }) } });
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  await mikey.post("/calls/hours", { ...allWeek, "call-minutes": "60", "gap-minutes": "0", "notice-hours": "1", "days-ahead": "14", "portal-open": "1", "public-open": "1" });
  token = issueSiteToken(t.services.publicSite);
});
after(() => t.stop());

test("an inquiry from the website keeps its stop, page and campaign; odd fields are dropped and the inquiry still lands", async () => {
  const res = await httpClient(t.origin).post("/contact", { name: "Kay Lambert", email: "kay@example.com", message: "Kayak rentals at the lake", src: "stop:lakes", page: "/stops/lakes?x=1", utm_source: "facebook", utm_campaign: "Spring 2027", return_to: `${SITE}/thanks` }, { origin: SITE });
  assert.equal(res.status, 303);
  const id = opportunityOf("Kayak rentals");
  assert.deepEqual({ ...t.db.prepare("select src, path, utm_source, utm_campaign from lead_touch where opportunity_id = ?").get(id) }, { src: "stop:lakes", path: "/stops/lakes", utm_source: "facebook", utm_campaign: "Spring 2027" });
  assert.match(textOf(await mikey.page(`/opportunities/${id}`)), /On the website River stop: Lakes and outdoors · \/stops\/lakes Campaign: facebook · Spring 2027/);

  await httpClient(t.origin).post("/contact", { name: "Odd One", email: "odd@example.com", message: "Strange fields", src: "<script>", page: "javascript:x" });
  assert.equal(t.db.prepare("select count(*) as n from lead_touch where opportunity_id = ?").get(opportunityOf("Strange fields"))?.["n"], 0);
});

test("HQ's own contact page passes src on from its address", async () => {
  const visitor = httpClient(t.origin);
  assert.match(await visitor.page("/contact?src=lab:counter"), /<input[^>]*type="hidden"[^>]*name="src"[^>]*value="lab:counter"/);
  assert.doesNotMatch(await visitor.page("/contact?src=%22%3E%3Cb%3E"), /name="src"/);
  await visitor.post("/contact", { name: "Lou Diner", email: "lou@example.com", message: "Saw the Counter demo", src: "lab:counter" });
  assert.equal(t.db.prepare("select src from lead_touch where opportunity_id = ?").get(opportunityOf("Saw the Counter demo"))?.["src"], "lab:counter");
});

test("a booking from the website keeps where the person was, on the opportunity it made", async () => {
  const times = (await (await fetch(`${t.origin}/api/site/booking`, { headers: { authorization: `Bearer ${token}` } })).json()) as { days: { slots: { start: string }[] }[] };
  const start = times.days[0]?.slots[0]?.start ?? "";
  const res = await fetch(`${t.origin}/api/site/booking`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ visitor: "203.0.113.9", name: "Wes Shrout", email: "wes@example.com", phone: "304-555-0177", business: "Shrout Feed", topic: "A store site", start, src: "planner", page: "/" }) });
  assert.equal(((await res.json()) as { status: string }).status, "booked");
  const client = t.db.prepare("select id from client_organization where name = 'Shrout Feed'").get()?.["id"] as Id;
  const touch = t.db.prepare("select t.src from lead_touch t join opportunity o on o.id = t.opportunity_id where o.organization_id = ?").get(client);
  assert.equal(touch?.["src"], "planner");
});

test("the report counts each source's leads, and what became of them; values only for those who may see them", async () => {
  // Kay's lead had a call and was won.
  const kay = opportunityOf("Kayak rentals");
  unwrap(crm.logTouch(t.services.touches, mikeyId, { opportunityId: kay }, { kind: "call", outcome: "reached", note: "Talked rentals" }));
  t.db.prepare("update opportunity set stage = 'won', service = 'website', pricing = 'fixed', value_minor = 150000, closed_at = created_at where id = ?").run(kay);
  // A phone lead entered by hand.
  const phoneClient = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Moats Hardware" })).id;
  unwrap(crm.createOpportunity(t.services.crm, mikeyId, phoneClient, { title: "Hardware store site", leadSource: "phone" }));

  const page = textOf(await mikey.page("/reports/lead-sources?days=30"));
  assert.match(page, /5 leads/);
  assert.match(page, /River stop: Lakes and outdoors 1 1 \(100%\) 1 \(100%\) 1 \(100%\) \$1,500\.00/);
  assert.match(page, /Lab demo: Counter 1 0 \(0%\)/);
  assert.match(page, /The 60-second planner 1/);
  assert.match(page, /Phone 1/);
  assert.match(page, /Website, page unknown 1/);
  assert.match(page, /1 website lead came with nothing to say where on the site/);
  assert.match(textOf(await mikey.page("/reports")), /Lead sources ?: where leads come from/);
  assert.equal((await sam.get("/reports/lead-sources")).status, 403);
});

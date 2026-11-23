// Today over real HTTP: one list across HQ in the order to work it, to-dos
// ticked off in place, and a call booked for later today at the top.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import { addRenewal } from "../../src/renewals/index.ts";
import { createServices } from "../../src/services.ts";
import type { Id } from "../../src/shared/index.ts";
import { todayFor } from "../../src/today/index.ts";
import { signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let mikeyId: Id;
let clientId: Id;
const day = (days: number) => Temporal.Now.plainDateISO("America/New_York").add({ days }).toString();

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await mikey.get("/");
  mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  clientId = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Elk Diner", sizeTier: "small" })).id;
});
after(() => t.stop());

test("with nothing due, Today says so", async () => {
  const page = textOf(await mikey.page("/today"));
  assert.match(page, /Today .* Nothing due today\. A good day to find new work\. All clear Nothing due/);
});

test("an overdue follow-up, today's to-do and a renewal this week, in that order", async () => {
  const late = unwrap(crm.createOpportunity(t.services.crm, mikeyId, clientId, { title: "Online orders", leadSource: "website" }));
  t.db.prepare("update opportunity set follow_up_on = ? where id = ?").run(day(-3), late.id);
  unwrap(addRenewal(t.services.renewals, mikeyId, clientId, { kind: "domain", name: "elkdiner.com", renewsOn: day(4), termMonths: "12" }));
  await mikey.post("/todos", { title: "Call the bank about the business account", dueOn: day(0), back: "today" });
  await mikey.post("/todos", { title: "Not until next week", dueOn: day(6) });
  const page = textOf(await mikey.page("/today"));
  assert.match(page, /3 things today, 1 overdue\. In order Overdue follow up Online orders Elk Diner · .* Log a call : Online orders Done: Call the bank about the business account To-do Call the bank about the business account .* Renewal elkdiner\.com renews Elk Diner/);
  assert.doesNotMatch(page, /Not until next week/);
});

test("a to-do ticked off on Today goes to Done today", async () => {
  const id = t.db.prepare("select id from todo where title like 'Call the bank%'").get()?.["id"] as string;
  const res = await mikey.post(`/todos/${id}/done`, { back: "today" });
  assert.equal(res.headers.get("location")?.split("?")[0], "/today");
  const page = textOf(await mikey.page("/today"));
  assert.match(page, /2 things today, 1 overdue\./);
  assert.match(page, /Done today: 1 Call the bank about the business account/);
});

test("a call booked for later today comes first", () => {
  const now = Temporal.Now.zonedDateTimeISO("America/New_York").with({ hour: 8, minute: 0 });
  const at = now.with({ hour: 14 }).toInstant().toString();
  t.db.prepare("insert into booking (id, kind, status, starts_at, ends_at, name, email, topic, host_id, created_at) values (?, 'public', 'booked', ?, ?, 'Dale Pruitt', 'dale@example.com', 'A website for the farm', ?, ?)").run(crypto.randomUUID(), at, Temporal.Instant.from(at).add({ minutes: 30 }).toString(), mikeyId, at);
  const services = createServices(t.db, { clock: () => now.toInstant().toString() });
  const view = todayFor(services.day, mikeyId);
  assert.equal(view.items[0]?.kind, "call");
  assert.match(view.items[0]?.text ?? "", /^Dale Pruitt, .*2:00/);
  assert.match(view.items[0]?.detail ?? "", /A website for the farm/);
  assert.match(view.headline, /1 call booked/);
});

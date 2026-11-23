// To-dos over real HTTP: your own by when, one for someone else, one on an
// opportunity that shows on its client, ticked off and put back.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { actions, signIn, testApp, textOf, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
let clientId: Id;
let opportunityId: Id;
const where = (res: Response) => res.headers.get("location") ?? "";
const problemOf = (res: Response) => new URL(t.origin + where(res)).searchParams.get("problem") ?? "";
const day = (days: number) => Temporal.Now.plainDateISO("America/New_York").add({ days }).toString();
const idOf = (title: string) => t.db.prepare("select id from todo where title = ?").get(title)?.["id"] as string;

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
  const mikeyId = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  clientId = unwrap(crm.createClient(t.services.crm, mikeyId, { name: "Elk Diner", sizeTier: "small" })).id;
  opportunityId = unwrap(crm.createOpportunity(t.services.crm, mikeyId, clientId, { title: "Online orders", leadSource: "website" })).id;
});
after(() => t.stop());

test("your to-dos sort into overdue, today, coming up and whenever", async () => {
  assert.match(textOf(await mikey.page("/todos")), /Nothing to do/);
  assert.equal(problemOf(await mikey.post("/todos", { title: " " })), "Say what needs doing.");
  await mikey.post("/todos", { title: "Renew the business license", dueOn: day(-2) });
  await mikey.post("/todos", { title: "Call the bank", dueOn: day(0) });
  await mikey.post("/todos", { title: "Order business cards", dueOn: day(5) });
  await mikey.post("/todos", { title: "Read the insurance policy" });
  const page = textOf(await mikey.page("/todos"));
  assert.match(page, /Overdue Done: Renew the business license Renew the business license .* Today Done: Call the bank .* Coming up Done: Order business cards .* Whenever Done: Read the insurance policy Read the insurance policy Whenever/);
});

test("a to-do for someone else is theirs; Everyone's shows whose it is", async () => {
  const samId = t.db.prepare("select id from user where email = 'sam@example.com'").get()?.["id"] as string;
  await mikey.post("/todos", { title: "Photograph the diner", assigneeId: samId, clientId });
  assert.doesNotMatch(textOf(await mikey.page("/todos")), /Photograph the diner/);
  assert.match(textOf(await sam.page("/todos")), /Whenever Done: Photograph the diner Photograph the diner Whenever · Elk Diner/);
  assert.match(textOf(await mikey.page("/todos?everyone=1")), /Photograph the diner Whenever · Sam Rivers · Elk Diner/);
});

test("a to-do on an opportunity shows there and on its client, and lands back where it was added", async () => {
  const res = await mikey.post("/todos", { title: "Send the quote", dueOn: day(1), opportunityId, back: "opportunity", backId: opportunityId });
  assert.equal(where(res).split("?")[0], `/opportunities/${opportunityId}`);
  assert.match(textOf(await mikey.page(`/opportunities/${opportunityId}`)), /To-dos Done: Send the quote Send the quote /);
  assert.match(textOf(await mikey.page(`/clients/${clientId}`)), /To-dos .*Send the quote .*· Online orders/);
});

test("ticked off, it moves to Done this week; reopened, it is back", async () => {
  const id = idOf("Call the bank");
  await mikey.post(`/todos/${id}/done`, {});
  let page = textOf(await mikey.page("/todos"));
  assert.doesNotMatch(page, /Today Done: Call the bank/);
  assert.match(page, /Done this week ✓ Not done: Call the bank/);
  assert.equal(problemOf(await mikey.post(`/todos/${id}/done`, {})), "That doesn’t exist, or it was already done.");
  await mikey.post(`/todos/${id}/reopen`, {});
  page = textOf(await mikey.page("/todos"));
  assert.match(page, /Today Done: Call the bank/);
  for (const action of ["todo.added", "todo.done", "todo.reopened"]) assert.ok(actions(t.db).includes(action), action);
});

// The morning email: each person's Today list, once a day, to anyone who
// hasn't turned it off in Settings; nothing on a day with nothing due.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServices } from "../../src/services.ts";
import type { Id } from "../../src/shared/index.ts";
import { sendMorningEmails } from "../../src/today/index.ts";
import { actions, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let mikey: Client;
let sam: Client;
const sentTo: { to: string; subject: string; body: string }[] = [];
const mail = async (message: { to: string; subject: string; body: string }) => (sentTo.push(message), true);
const run = () => sendMorningEmails(createServices(t.db).morning, mail, { publicUrl: "https://hq.example" });

before(async () => {
  t = await testApp();
  mikey = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  sam = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await mikey.get("/");
  await sam.get("/");
});
after(() => t.stop());

test("nothing due, nothing sent", async () => {
  assert.deepEqual(await run(), { sent: 0, failed: 0, nothingDue: 2 });
});

test("each person gets their own list, once a day, with links into HQ", async () => {
  await mikey.post("/todos", { title: "Call the bank", dueOn: Temporal.Now.plainDateISO("America/New_York").toString() });
  assert.deepEqual(await run(), { sent: 1, failed: 0, nothingDue: 1 });
  const [email] = sentTo;
  assert.equal(email?.to, "mikey@example.com");
  assert.match(email?.subject ?? "", /^Today, \w+day, \w+ \d+: 1 thing today$/);
  assert.match(email?.body ?? "", /^Good morning, Mikey\.\n\n1 thing today\.\n\n1\. To-do: Call the bank\n {3}\w{3}, \w{3} \d+, today\n {3}https:\/\/hq\.example\/todos\n/);
  assert.match(email?.body ?? "", /Work through it in HQ: https:\/\/hq\.example\/today/);
  assert.deepEqual(await run(), { sent: 0, failed: 0, nothingDue: 1 }, "not twice in a day");
  assert.ok(actions(t.db).includes("user.morning-email-sent"));
});

test("turned off in Settings, it isn't sent", async () => {
  assert.match(textOf(await mikey.page("/settings")), /Morning email At 7 each morning, .* HQ can’t send email yet/);
  await mikey.post("/settings/morning-email", {});
  t.db.prepare("delete from morning_email_sent").run();
  assert.deepEqual(await run(), { sent: 0, failed: 0, nothingDue: 1 });
  await mikey.post("/settings/morning-email", { morningEmail: "1" });
  assert.equal((await run()).sent, 1);
  assert.ok(actions(t.db).includes("user.morning-email-off") && actions(t.db).includes("user.morning-email-on"));
});

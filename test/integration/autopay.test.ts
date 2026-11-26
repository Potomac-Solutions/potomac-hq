// Autopay for plan invoices (2026-11-26), with a stand-in platform.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { runAutopay, type SavedPay } from "../../src/autopay/index.ts";
import * as finance from "../../src/finance/index.ts";
import { createServices } from "../../src/services.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, signIn, testApp, textOf, wonProject, type Client, type TestApp } from "../support/harness.ts";

const charges: { token: string; key: string; cents: number }[] = [];
const forgotten: string[] = [];
let next: Awaited<ReturnType<SavedPay["charge"]>> = { outcome: "paid", reference: "CAP-1" };
const platform: SavedPay = {
  platform: "paypal",
  begin: async ({ back }) => ({ ok: true, setup: "SETUP-1", url: `https://paypal.test/approve?back=${encodeURIComponent(back)}` }),
  keep: async (setup) => (setup === "SETUP-1" ? { ok: true, token: "PT-1", label: "PayPal (bob@feed.example)" } : { ok: false, reason: "no" }),
  charge: async (input) => (charges.push(input), next),
  forget: async (token) => (forgotten.push(token), true),
};
let t: TestApp;
let admin: Client;
let mikey: Id;
const today = Temporal.Now.plainDateISO("America/New_York");
const day = (n: number) => today.add({ days: n }).toString();
const run = (n: number) => runAutopay(createServices(t.db, { savedPay: platform, today: () => day(n), clock: () => `${day(n)}T15:00:00Z` }).autopay);
const doneOf = (res: Response) => new URL("http://x" + (res.headers.get("location") ?? "")).searchParams.get("done") ?? "";

before(async () => {
  t = await testApp({ savedPay: platform, publicUrl: "https://hq.example" });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
});
after(() => t.stop());

test("offered only with a plan; set up through the platform; plan bills are charged once; stopping removes the saved account", async () => {
  const won = await wonProject(t.services, mikey, { client: "Gormania Feed", title: "Feed store website" });
  const bob = await clientSignedIn(t, admin, won.client.id, "Bob Miller", "bob@feed.example");
  assert.doesNotMatch(textOf(await bob.page("/portal")), /Pay my plan automatically/, "no plan, no offer");

  await admin.post(`/clients/${won.client.id}/recurring`, { description: "Hosting and upkeep", amount: "49", every: "month", firstOn: day(0), autoSend: "1", dueDays: "15" });
  assert.match(textOf(await bob.page("/portal")), /Pay my plan automatically .* Set up with PayPal/);

  const off = await bob.post("/portal/autopay", {});
  assert.equal(off.status, 303);
  assert.equal(off.headers.get("location"), "/portal/autopay/go");
  const go = await bob.get("/portal/autopay/go");
  assert.match(go.headers.get("refresh") ?? "", /^0;url=https:\/\/paypal\.test\/approve\?back=https%3A%2F%2Fhq\.example%2Fportal%2Fautopay%2Fdone$/);
  assert.match(await go.text(), /Continue to PayPal/);
  const back = await bob.get("/portal/autopay/done");
  assert.match(doneOf(back), /paid automatically from PayPal \(bob@feed\.example\)/);
  assert.match(textOf(await bob.page("/portal")), /Your plan bills are paid from PayPal \(bob@feed\.example\)/);
  assert.match(textOf(await admin.page(`/clients/${won.client.id}`)), /Automatic payment On: plan bills are charged to PayPal \(bob@feed\.example\)/);

  // A one-off invoice isn't charged; the plan's is, once.
  const oneOff = finance.createInvoice(t.services.finance, mikey, won.project.id, { kind: "balance", description: "Extra page", amount: "200" });
  assert.ok(oneOff.ok);
  finance.sendInvoiceNow(t.services.finance, mikey, oneOff.value.id);
  finance.runRecurringInvoices(createServices(t.db, { today: () => day(0) }).finance);
  // Before the morning run: the plan bill isn't "waiting on you", and says it's paid automatically. The one-off is theirs to pay.
  const before = textOf(await bob.page("/portal"));
  assert.match(before, /1 thing is waiting on you Pay invoice INV-\d{4}: \$200\.00/);
  assert.match(before, /\$49\.00 owed[^$]*Paid automatically from PayPal \(bob@feed\.example\), usually the morning it’s sent\. Nothing to do\./);
  assert.deepEqual(await run(0), { paid: 1, declined: 0, unclear: 0 });
  assert.deepEqual(charges.map((one) => one.cents), [4900]);
  assert.deepEqual(await run(0), { paid: 0, declined: 0, unclear: 0 }, "not twice");
  const plan = t.db.prepare("select status from invoice where recurring_id is not null").get();
  assert.equal(plan?.["status"], "paid");
  assert.match(String(t.db.prepare("select reference from payment order by rowid desc limit 1").get()?.["reference"]), /PayPal autopay CAP-1/);

  assert.match(doneOf(await bob.post("/portal/autopay/stop", {})), /Automatic payment is off/);
  assert.deepEqual(forgotten, ["PT-1"]);
  assert.match(textOf(await bob.page("/portal")), /Set up with PayPal/);
});

test("declined is tried again after 3 and 7 days, then a to-do; an unclear answer is never retried", async () => {
  const won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website" });
  const stacy = await clientSignedIn(t, admin, won.client.id, "Stacy Roberts", "stacy@betterdays.example");
  await admin.post(`/clients/${won.client.id}/recurring`, { description: "Upkeep", amount: "30", every: "month", firstOn: day(0), autoSend: "1", dueDays: "15" });
  await stacy.post("/portal/autopay", {});
  await stacy.get("/portal/autopay/done");
  finance.runRecurringInvoices(createServices(t.db, { today: () => day(0) }).finance);
  next = { outcome: "declined", reason: "INSTRUMENT_DECLINED" };
  charges.length = 0;
  assert.equal((await run(0)).declined, 1);
  // The client is told, with the day of the next try; staff see the same.
  const told = textOf(await stacy.page("/portal"));
  assert.match(told, /1 thing is waiting on you Pay invoice INV-\d{4}: \$30\.00 ?We couldn’t take this from PayPal \(bob@feed\.example\) on \w{3}, \w{3} \d+\. We’ll try again \w{3}, \w{3} \d+\. Or pay it by card now/);
  assert.match(textOf(await admin.page(`/clients/${won.client.id}`)), /INV-\d{4}, \$30\.00: declined; HQ tries again \w{3}, \w{3} \d+\. The client is told in their portal\./);
  assert.equal((await run(2)).declined, 0, "waits");
  assert.equal((await run(3)).declined, 1);
  assert.equal((await run(7)).declined, 1);
  assert.equal((await run(20)).declined, 0, "out of tries");
  assert.equal(charges.length, 3);
  assert.match(String(t.db.prepare("select title from task order by rowid desc limit 1").get()?.["title"]), /Autopay declined three times for INV-\d{4}/);
  const staff = textOf(await admin.page(`/clients/${won.client.id}`));
  assert.match(staff, /Declined \(PayPal said: INSTRUMENT_DECLINED\)/);
  assert.match(staff, /declined three times\. HQ won’t try again; the client is asked to pay it in their portal/);
  assert.match(textOf(await stacy.page("/portal")), /We couldn’t take this from PayPal \(bob@feed\.example\) after three tries, so it’s yours to pay/);

  // A new plan bill whose charge has no clear answer: a to-do, and no retry.
  t.db.prepare("update invoice set status = 'void' where recurring_id is not null and organization_id = ?").run(won.client.id);
  finance.runRecurringInvoices(createServices(t.db, { today: () => day(31) }).finance);
  next = { outcome: "unknown", reason: "paypal-http-503" };
  charges.length = 0;
  assert.equal((await run(31)).unclear, 1);
  const unclear = textOf(await stacy.page("/portal"));
  assert.match(unclear, /Nothing is waiting on you/);
  assert.match(unclear, /We’re checking with PayPal whether this went through\. Nothing to do for now\./);
  assert.equal((await run(40)).unclear, 0);
  assert.equal(charges.length, 1);
  assert.match(String(t.db.prepare("select title from task order by rowid desc limit 1").get()?.["title"]), /Check whether autopay took \$30\.00/);
});

test("staff can turn it off; a client without card pay set up for saving isn't offered it", async () => {
  const won = await wonProject(t.services, mikey, { client: "Moats Hardware", title: "Store" });
  const rita = await clientSignedIn(t, admin, won.client.id, "Rita Moats", "rita@moats.example");
  await admin.post(`/clients/${won.client.id}/recurring`, { description: "Upkeep", amount: "20", every: "month", firstOn: day(0), autoSend: "1", dueDays: "15" });
  await rita.post("/portal/autopay", {});
  await rita.get("/portal/autopay/done");
  assert.match(doneOf(await admin.post(`/clients/${won.client.id}/autopay/stop`, {})), /Automatic payment is off for this client\./);
  assert.match(textOf(await admin.page(`/clients/${won.client.id}`)), /Automatic payment Off\./);

  const plain = await testApp();
  try {
    const boss = await signIn(plain, "mikey@example.com", "Mikey Nichols", ["admin"]);
    await boss.get("/");
    const id = plain.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
    const other = await wonProject(plain.services, id, { client: "Elk Diner", title: "Menu" });
    const dana = await clientSignedIn(plain, boss, other.client.id, "Dana", "dana@elk.example");
    await boss.post(`/clients/${other.client.id}/recurring`, { description: "Upkeep", amount: "20", every: "month", firstOn: day(0), autoSend: "1", dueDays: "15" });
    assert.doesNotMatch(textOf(await dana.page("/portal")), /Pay my plan automatically/);
  } finally {
    await plain.stop();
  }
});

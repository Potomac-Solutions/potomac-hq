// The billing extras (decision 0017, third part, Mikey 2026-11-25: "Do all
// of these"): on an invoice, a promise to pay, a card payment link, a
// write-off and sending in one step; on a client, who gets the bills, the
// money line, prepaid hours and plans with no project; renewals billed
// together, a price change told first and the next 12 months; receipts,
// statements, how to pay, the yearly payments download and the free page
// with its domain in the portal; and the cash forecast.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import * as renewals from "../../src/renewals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, signIn, testApp, textOf, unwrap, wonProject, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let stacy: Client;
let mikey: Id;
let clientId: Id;
let projectId: Id;
const today = Temporal.Now.plainDateISO("America/New_York");
const day = (days: number) => today.add({ days }).toString();
const problemOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get("done") ?? "";
const invoiceIdIn = (res: Response) => /\/invoices\/([0-9a-f-]{36})/.exec(res.headers.get("location") ?? "")?.[1] as Id;

before(async () => {
  t = await testApp();
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const won = await wonProject(t.services, mikey, { client: "Better Days Towing", title: "Website rebuild" });
  clientId = won.client.id;
  projectId = won.project.id;
  stacy = await clientSignedIn(t, admin, clientId, "Stacy Roberts", "stacy@betterdays.example");
});
after(() => t.stop());

test("a one-off charge can be drafted and sent in one step", async () => {
  const sent = await admin.post(`/clients/${clientId}/invoices`, { kind: "other", description: "Domain transfer", amount: "20", send: "on" });
  assert.equal(doneOf(sent), "Invoice sent. It’s in the client’s portal.");
  assert.equal(t.services.finance.invoices.get(invoiceIdIn(sent))?.status, "sent");
  assert.match(textOf(await stacy.page("/portal")), /Domain transfer/);
});

test("a promise to pay shows on Today that day; a card link shows in the portal; a write-off stops it being owed", async () => {
  const made = await admin.post(`/clients/${clientId}/invoices`, { kind: "other", description: "Logo touch-up", amount: "80", send: "on", dueOn: day(-10) });
  const id = invoiceIdIn(made);
  assert.equal(doneOf(await admin.post(`/invoices/${id}/promise`, { on: day(0), note: "Paying Friday by check" })), "Saved. Today will remind you that day.");
  assert.match(textOf(await admin.page("/today")), /Better Days Towing promised to pay INV-\d{4}[\s\S]*Paying Friday by check/);
  assert.equal(problemOf(await admin.post(`/invoices/${id}/promise`, { on: "soon" })), "Enter a date.");

  assert.equal(problemOf(await admin.post(`/invoices/${id}/pay-link`, { link: "http://pay.example/abc" })), "Paste the payment link as it starts: https://…");
  assert.equal(doneOf(await admin.post(`/invoices/${id}/pay-link`, { link: "https://pay.example/abc" })), "Saved. The client sees “Pay by card” in their portal.");
  const portal = await stacy.page("/portal");
  assert.match(portal, /href="https:\/\/pay\.example\/abc"/);
  assert.match(textOf(portal), /Pay by card/);

  assert.equal(problemOf(await admin.post(`/invoices/${id}/write-off`, { note: "" })), "Say why it’s written off.");
  assert.equal(doneOf(await admin.post(`/invoices/${id}/write-off`, { note: "Closed for the season; no reply." })), "Written off. It’s no longer owed.");
  const invoice = t.services.finance.invoices.get(id);
  assert.deepEqual([invoice?.status, invoice?.writtenOffNote, invoice?.promisedOn], ["void", "Closed for the season; no reply.", null]);
  assert.match(textOf(await admin.page(`/invoices/${id}`)), /Nothing: written off/);
  assert.match(textOf(await admin.page("/money/invoices?show=void")), /Written off/);
  assert.doesNotMatch(textOf(await admin.page("/today")), /promised to pay/);
  assert.doesNotMatch(await stacy.page("/portal"), /pay\.example/);
  assert.ok(events(t.db).some((event) => event.action === "invoice.written-off" && event.record === id));
});

test("who gets the bills: a contact of the client's with an email; reminders go to them", async () => {
  const bookkeeper = unwrap(crm.addContact(t.services.crm, mikey, clientId, { name: "Dana Books", email: "dana@books.example", phone: null, title: "Bookkeeper", isPrimary: false }));
  const other = unwrap(crm.createClient(t.services.crm, mikey, { name: "Moats Hardware" }));
  const outsider = unwrap(crm.addContact(t.services.crm, mikey, other.id, { name: "Moe", email: "moe@moats.example", phone: null, title: null, isPrimary: true }));
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/billing-contact`, { contactId: outsider.id })), "That contact belongs to a different client.");
  assert.equal(doneOf(await admin.post(`/clients/${clientId}/billing-contact`, { contactId: bookkeeper.id })), "Saved. Bills, reminders, receipts and statements go to whoever you chose.");
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Dana Books[\s\S]*Gets the bills/);
  const someInvoice = t.services.finance.invoices.listForClient(clientId).find((one) => one.status === "sent") as { id: Id };
  const view = unwrap(finance.invoiceReminders(t.services.invoiceReminders, mikey, someInvoice.id));
  assert.equal(view.recipients, "dana@books.example");
});

test("the client's money line, prepaid hours running low, and a plan with no project", async () => {
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Money Owed now \$\d[\s\S]*Paid this year/);

  assert.equal(problemOf(await admin.post(`/clients/${clientId}/prepaid`, { hours: "lots", boughtOn: day(0) })), "Enter hours like 1.5.");
  assert.equal(doneOf(await admin.post(`/clients/${clientId}/prepaid`, { hours: "2", boughtOn: day(0), price: "150", send: "on" })), "Saved, with its invoice.");
  unwrap(finance.logTime(t.services.finance, mikey, { projectId }, { on: day(0), hours: "1.75" }));
  const page = textOf(await admin.page(`/clients/${clientId}`));
  assert.match(page, /Prepaid hours left 15 min Low/);
  assert.match(page, /2 h, bought/);
  assert.match(textOf(await admin.page("/today")), /Better Days Towing’s prepaid hours are running low/);
  assert.ok(t.services.finance.invoices.listForClient(clientId).some((one) => one.lines[0]?.description === "2 prepaid hours" && one.status === "sent"));

  assert.equal(doneOf(await admin.post(`/clients/${clientId}/recurring`, { description: "Hosting and upkeep", amount: "49", every: "month", firstOn: day(0), autoSend: "1", dueDays: "15" })), "Saved. HQ makes each invoice on its day.");
  const made = finance.runRecurringInvoices(t.services.finance);
  assert.equal(made.made, 1);
  const hosting = t.services.finance.invoices.listForClient(clientId).find((one) => one.lines[0]?.description.startsWith("Hosting and upkeep"));
  assert.deepEqual([hosting?.projectId, hosting?.status], [null, "sent"]);
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Hosting and upkeep · \$49\.00/);
  assert.match(textOf(await admin.page("/money")), /Hosting and upkeep[\s\S]*No project/);
});

test("renewals billed together on one invoice, a price change told first, and the next 12 months with a loss flagged", async () => {
  const domain = unwrap(renewals.addRenewal(t.services.renewals, mikey, clientId, { kind: "domain", name: "betterdaystowing.com", renewsOn: day(20), termMonths: "12", cost: "15", price: "25" }));
  const email = unwrap(renewals.addRenewal(t.services.renewals, mikey, clientId, { kind: "email", name: "Business email", renewsOn: day(25), termMonths: "12", cost: "72", price: "60" }));
  assert.match(await admin.page(`/clients/${clientId}`), new RegExp(`name="bill-${domain.id}" form="bill-together"`));
  assert.equal(problemOf(await admin.post(`/clients/${clientId}/renewals/bill-together`, { [`bill-${domain.id}`]: "on", projectId: "" })), "Tick at least two renewals to bill together.");

  // The year ahead, before billing: email is billed for less than it costs.
  const year = textOf(await admin.page("/renewals/year"));
  assert.match(year, /Billed at a loss 1/);
  assert.match(year, /Business email[\s\S]*−\$12\.00 Loss/);

  assert.equal(problemOf(await admin.post(`/renewals/${email.id}/price`, { price: "60" })), "That’s the price already.");
  assert.equal(doneOf(await admin.post(`/renewals/${email.id}/price`, { price: "90", back: "client", clientId })), "Price changed. The client sees the new price in their portal before the next bill.");
  assert.match(textOf(await stacy.page("/portal")), /New price from your next bill: \$90\.00, every year \(it was \$60\.00\)\./);
  assert.match(textOf(await admin.page(`/clients/${clientId}`)), /Price changed .*: \$90\.00, was \$60\.00/);

  assert.equal(doneOf(await admin.post(`/clients/${clientId}/renewals/bill-together`, { [`bill-${domain.id}`]: "on", [`bill-${email.id}`]: "on", projectId: "" })), "Billed 2 together on one invoice, in the client’s portal.");
  const a = t.services.renewals.renewals.get(domain.id);
  const b = t.services.renewals.renewals.get(email.id);
  assert.ok(a?.invoiceId);
  assert.equal(a.invoiceId, b?.invoiceId);
  const invoice = t.services.finance.invoices.get(a.invoiceId);
  assert.deepEqual([invoice?.lines.length, invoice?.total.minor, invoice?.dueOn, invoice?.status], [2, 11500, day(13), "sent"]);
});

test("receipts go out once, to whoever gets the bills, when invoice emails are on; statements once a month", async () => {
  unwrap(finance.setInvoiceReminders(t.services.invoiceReminders, mikey, true));
  const owed = t.services.finance.invoices.listForClient(clientId).find((one) => one.status === "sent" && one.lines[0]?.description === "Domain transfer") as { id: Id };
  unwrap(finance.recordPayment(t.services.finance, mikey, owed.id, { amount: "20", method: "check", on: day(0), reference: "1001" }));
  const mails: { to: string; subject: string; body: string }[] = [];
  const mail = async (message: { to: string; subject: string; body: string }) => (mails.push(message), true);
  const options = { publicUrl: "https://hq.example", phone: "304-555-0100", address: "1 River Rd" };
  const first = await finance.sendReceipts(t.services.invoiceReminders, mail, options);
  assert.ok(first.sent >= 1);
  const receipt = mails.find((one) => one.subject.startsWith("Receipt for"));
  assert.equal(receipt?.to, "dana@books.example");
  assert.match(receipt?.body ?? "", /we received \$20\.00 for invoice INV-\d{4}/);
  const again = await finance.sendReceipts(t.services.invoiceReminders, mail, options);
  assert.equal(again.sent, 0, "never twice");

  const firstOfMonth = today.with({ day: 1 }).add({ months: 1 }).toString();
  const atMonthStart = { ...t.services.invoiceReminders, today: () => firstOfMonth };
  mails.length = 0;
  const statements = await finance.sendStatements(atMonthStart, mail, options);
  assert.equal(statements.sent, 1);
  assert.equal(mails[0]?.to, "dana@books.example");
  assert.match(mails[0]?.subject ?? "", /^Your statement for .+: \$[\d,.]+ owed$/);
  assert.match(mails[0]?.body ?? "", /betterdaystowing\.com: domain renewal/);
  assert.equal((await finance.sendStatements(atMonthStart, mail, options)).sent, 0, "once a month");
  assert.equal((await finance.sendStatements({ ...t.services.invoiceReminders, today: () => today.with({ day: 15 }).toString() }, mail, options)).sent, 0, "only in a month's first week");
});

test("how to pay in Potomac's words, and a yearly download of what the client paid", async () => {
  assert.equal(problemOf(await admin.post("/money/pay-instructions", { instructions: "Card 4242 4242 4242 4242" })), "That looks like a card or account number. Every client sees this text, so leave it out: say how to ask for transfer details instead.");
  assert.equal(doneOf(await admin.post("/money/pay-instructions", { instructions: "Checks to Potomac Solutions LLC.\nAsk us for bank transfer details." })), "Saved. Clients see it in their portal.");
  const portal = textOf(await stacy.page("/portal"));
  assert.match(portal, /Checks to Potomac Solutions LLC\./);
  const year = today.year;
  assert.match(await stacy.page("/portal"), new RegExp(`href="/portal/payments\\.csv\\?year=${year}"`));
  const csv = await stacy.get(`/portal/payments.csv?year=${year}`);
  assert.equal(csv.status, 200);
  const body = await csv.text();
  assert.match(body, /Received,Invoice,For,How,Reference,Amount/);
  assert.match(body, /Domain transfer,Check,1001,20\.00/);
  assert.equal((await admin.get(`/portal/payments.csv?year=${year}`)).status, 404, "staff aren't a client");
});

test("the portal shows a free page with its own domain's renewal together", async () => {
  await admin.post(`/clients/${clientId}/landing-page`, { status: "building", repo: "", subdomain: "", where: "own", ownDomain: "betterdaystowing.com" });
  assert.match(textOf(await stacy.page("/portal")), /Your domain renews .+, \$25\.00 a year\./);
});

test("the cash forecast: invoices coming in by their due day, renewal costs going out", async () => {
  const page = textOf(await admin.page("/money/forecast"));
  assert.match(page, /The next 13 weeks Coming in \$[\d,.]+/);
  assert.match(page, /This week/);
  assert.match(page, /betterdaystowing\.com renews \(Better Days Towing\) −\$15\.00/);
  assert.match(page, /Hosting and upkeep, Better Days Towing/);
  assert.match(textOf(await admin.page("/money")), /Cash forecast/);
});

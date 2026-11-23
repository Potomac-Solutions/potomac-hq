// v0.6 in a real browser: Potomac invites a client, the client uses the
// one-time link, approves a deliverable, accepts a proposal by typing their
// name and asks for a call. Every portal screen gets the accessibility check,
// in light and in dark.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { saveBookingSetup } from "../../src/booking/index.ts";
import * as crm from "../../src/crm/index.ts";
import * as finance from "../../src/finance/index.ts";
import * as projects from "../../src/projects/index.ts";
import * as proposals from "../../src/proposals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { assertAccessible, setUpAdmin, text, watch } from "../support/browser.ts";
import { PASSWORD, PDF, TEST_PASSWORD_COST, testApp, unwrap, wonProject, type TestApp } from "../support/harness.ts";

let t: TestApp;
let browser: Browser;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await t.stop();
});

test("a client, from the invite to an accepted proposal", async () => {
  const staff = await (await browser.newContext()).newPage();
  const staffProblems = watch(staff);
  await setUpAdmin(t, staff);
  const s = t.services;
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const { client, project } = await wonProject(s, mikey);
  unwrap(projects.addMilestone(s.projects, mikey, project.id, { name: "Design signed off", dueOn: "2099-12-05" }));
  const deliverable = unwrap(projects.addDeliverable(s.projects, mikey, project.id, { title: "Home page design", file: { name: "design.pdf", bytes: PDF } }));
  unwrap(projects.setDeliverableShared(s.projects, mikey, deliverable.id, true));
  const opportunity = unwrap(crm.createOpportunity(s.crm, mikey, client.id, { title: "Online ordering", leadSource: "phone", service: "application" }));
  for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(s.crm, mikey, opportunity.id, { to }));
  const proposal = unwrap(proposals.startProposal(s.proposals, mikey, opportunity.id, {}));
  unwrap(proposals.sendProposalVersion(s.proposals, mikey, proposal.id));
  unwrap(proposals.setProposalShared(s.proposals, mikey, proposal.id, true));
  const invoice = unwrap(finance.createInvoice(s.finance, mikey, project.id, { kind: "deposit", description: "Deposit", amount: "500" }));
  unwrap(finance.sendInvoiceNow(s.finance, mikey, invoice.id));
  const change = unwrap(finance.addChangeRequest(s.finance, mikey, project.id, { title: "A gallery page", description: "Twelve photos of past work.", amount: "300", hours: "6" }));
  unwrap(finance.sendChangeRequest(s.finance, mikey, change.id));

  // Potomac invites Ann from the client's page and is shown her link.
  await staff.goto(`${t.origin}/clients/${client.id}`);
  await assertAccessible(staff, "a client with nobody invited to the portal");
  await staff.getByText("Invite someone to the portal").click();
  await staff.getByLabel("Their name").fill("Ann Baker");
  await staff.getByLabel("Their email").fill("ann@bakery.example");
  await staff.getByRole("button", { name: "Invite" }).click();
  await staff.getByText("Send this link to Ann Baker").waitFor();
  await assertAccessible(staff, "the one-time link");
  const link = await staff.getByLabel(/link/i).first().inputValue();
  assert.match(link, /\/portal\/accept\?token=/);

  // Ann opens it in her own browser.
  const ann = await (await browser.newContext()).newPage();
  const annProblems = watch(ann);
  await ann.goto(new URL(link, t.origin).href);
  await assertAccessible(ann, "accepting a portal invite");
  await ann.getByLabel(/Choose a password/).fill(PASSWORD);
  await ann.getByRole("button", { name: "Save and sign in" }).click();
  await ann.waitForURL((url) => url.pathname === "/portal");
  await assertAccessible(ann, "the portal's home");
  assert.match(await text(ann), /Mt\. Storm Bakery/);
  assert.equal(await ann.getByRole("link", { name: /Clients|Pipeline|Money/ }).count(), 0, "none of HQ's own navigation");

  // The project: approve the deliverable and send a message.
  await ann.getByRole("link", { name: project.name }).first().click();
  await ann.waitForURL((url) => url.pathname === `/portal/projects/${project.id}`);
  await assertAccessible(ann, "a project in the portal");
  const download = ann.waitForEvent("download");
  await ann.getByRole("link", { name: "Open design.pdf" }).click();
  assert.equal((await download).suggestedFilename(), "design.pdf");
  await ann.getByRole("button", { name: "Approve: Home page design" }).click();
  await ann.getByText("Your decision is recorded.").waitFor();
  await ann.getByRole("button", { name: "Approve change: A gallery page" }).click();
  await ann.getByText("Your answer is recorded.").waitFor();
  await ann.getByLabel("Send a message, or ask for a change").fill("Looks great. When do we launch?");
  await ann.getByRole("button", { name: "Send message" }).click();
  await ann.getByText("Message sent to Potomac Solutions.").waitFor();
  await assertAccessible(ann, "a project in the portal after a decision and a message");

  // Send a file from the project page.
  await ann.getByLabel("Choose a file, or take a photo").setInputFiles({ name: "menu.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF) });
  await ann.getByRole("button", { name: "Send file" }).click();
  await ann.getByText("File sent to Potomac Solutions.").waitFor();
  assert.match(await text(ann), /menu\.pdf .* sent by Ann Baker/);
  await assertAccessible(ann, "a project in the portal with a file sent");

  // The proposal: accept by typing her name.
  await ann.goto(`${t.origin}/portal/proposals/${proposal.id}`);
  await assertAccessible(ann, "a proposal in the portal");
  await ann.getByLabel("I accept this proposal").check();
  await ann.getByLabel("Type your full name").fill("Ann M. Baker");
  await ann.getByRole("button", { name: "Send my answer" }).click();
  await ann.getByText("Your answer is recorded.").waitFor();
  await assertAccessible(ann, "an answered proposal in the portal");

  // Book a call: Potomac opens Mondays to Fridays, 9 to 5.
  const weekdays = Object.fromEntries([1, 2, 3, 4, 5].flatMap((day) => [[`start-${day}-0`, "09:00"], [`end-${day}-0`, "17:00"]]));
  unwrap(saveBookingSetup(s.booking, mikey, { ...weekdays, "call-minutes": "30", "gap-minutes": "15", "notice-hours": "24", "days-ahead": "21", "portal-open": "1" }));
  await ann.goto(`${t.origin}/portal`);
  await ann.getByRole("link", { name: "Book a call" }).click();
  await ann.getByRole("heading", { name: "Book a call" }).waitFor();
  await assertAccessible(ann, "booking a call in the portal");
  await ann.getByLabel("What would you like to talk about?").fill("The holiday menu");
  await ann.getByRole("button", { name: /, 10:30 AM$/ }).first().click();
  await ann.getByText("Your call is booked.").waitFor();
  assert.match(await text(ann), /The holiday menu Add to your calendar · Move it/);
  await assertAccessible(ann, "the portal's home with a call booked");

  // Ask for a call. In dark, too.
  await ann.goto(`${t.origin}/portal`);
    await ann.getByLabel("When is a good time to call you?").fill("Thursday afternoon");
  await ann.getByLabel("The best number to reach you").fill("304-555-0199");
  await ann.getByRole("button", { name: "Ask for a call" }).click();
  await ann.getByText("Request sent.").waitFor();
  await ann.emulateMedia({ colorScheme: "dark" });
  await ann.reload();
  await assertAccessible(ann, "the portal's home in dark");
  await ann.goto(`${t.origin}/portal/projects/${project.id}`);
  await assertAccessible(ann, "a project in the portal in dark");
  await ann.emulateMedia({ colorScheme: "light" });

  // On a phone: nothing runs off the side of the screen, and every button is big enough to hit.
  await ann.setViewportSize({ width: 360, height: 740 });
  for (const [path, screen] of [["/portal", "the portal's home"], ["/portal/book", "booking a call"], [`/portal/projects/${project.id}`, "a project"], [`/portal/proposals/${proposal.id}`, "a proposal"]] as const) {
    await ann.goto(t.origin + path);
    const size = (await ann.evaluate("({ page: document.documentElement.scrollWidth, screen: window.innerWidth })")) as { page: number; screen: number };
    assert.ok(size.page <= size.screen, `${screen} is ${size.page}px wide on a ${size.screen}px phone`);
    const small = (await ann.evaluate(`[...document.querySelectorAll("main button, main a.hq-button")].filter((el) => el.checkVisibility() && el.getBoundingClientRect().height < 44).map((el) => (el.textContent ?? "").trim())`)) as string[];
    assert.deepEqual(small, [], `${screen} has buttons under 44px tall`);
    await assertAccessible(ann, `${screen} on a phone`);
  }
  await ann.setViewportSize({ width: 1280, height: 720 });

  // Potomac sees all of it.
  await staff.goto(`${t.origin}/`);
  assert.match(await text(staff), /Call Ann Baker back.*Wants: Thursday afternoon/);
  await assertAccessible(staff, "the dashboard with a call waiting");
  await staff.goto(`${t.origin}/projects/${project.id}`);
  assert.match(await text(staff), /Looks great\. When do we launch\?/);
  await assertAccessible(staff, "a project with client updates");
  await staff.goto(`${t.origin}/clients/${client.id}`);
  assert.match(await text(staff), /Ann Baker.*Has access/);
  await assertAccessible(staff, "a client with a portal user and a call request");

  // Signing out leaves nothing open.
  await ann.goto(`${t.origin}/portal`);
  await ann.getByRole("button", { name: "Sign out" }).click();
  await ann.waitForURL((url) => url.pathname === "/portal/sign-in");
  await assertAccessible(ann, "the portal's sign-in form");
  const closed = await ann.goto(`${t.origin}/portal/projects/${project.id}`);
  assert.equal(closed?.status(), 401);
  assert.doesNotMatch(await text(ann, "body"), /Home page design/);

  assert.deepEqual(annProblems.filter((p) => !/401/.test(p)), []);
  assert.deepEqual(staffProblems, []);
});

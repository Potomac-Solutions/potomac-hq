// Paying the deposit when accepting a proposal (2026-11-26). With card
// payments on, the deposit invoice goes to the client's portal the moment
// they accept, and they can go straight on to pay it. With them off, nothing
// changes: the deposit waits as a draft for a person to send.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import * as proposals from "../../src/proposals/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { clientSignedIn, events, signIn, testApp, textOf, unwrap, type TestApp } from "../support/harness.ts";

async function world(config: Parameters<typeof testApp>[0]) {
  const t = await testApp(config);
  const admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  const s = t.services;
  const client = unwrap(crm.createClient(s.crm, mikey, { name: "Elk Diner" }));
  const proposal = () => {
    const opportunity = unwrap(crm.createOpportunity(s.crm, mikey, client.id, { title: "Ordering app", leadSource: "phone", service: "application" }));
    for (const to of ["consult-booked", "consulted"]) unwrap(crm.moveOpportunity(s.crm, mikey, opportunity.id, { to }));
    const made = unwrap(proposals.startProposal(s.proposals, mikey, opportunity.id, {}));
    unwrap(proposals.saveProposal(s.proposals, mikey, made.id, { title: "Ordering app", pricing: "fixed", scope: "Orders ahead.", lines: [{ item: "Build", kind: "hours", quantity: "20", rate: "75" }] }));
    unwrap(proposals.sendProposalVersion(s.proposals, mikey, made.id));
    unwrap(proposals.setProposalShared(s.proposals, mikey, made.id, true));
    return made.id;
  };
  const rita = await clientSignedIn(t, admin, client.id, "Rita Okafor", "rita@elkdiner.example");
  const deposits = () => t.db.prepare("select id, status, total_minor from invoice where kind = 'deposit'").all() as { id: Id; status: string; total_minor: number }[];
  return { t, admin, rita, proposal, deposits };
}
const said = (t: TestApp, res: Response, name: "done" | "problem") => new URL(res.headers.get("location") ?? "", t.origin).searchParams.get(name) ?? "";

test("card payments on: accept and go straight to paying the deposit, which is sent; paid, it starts the project", async () => {
  const w = await world({ cardPay: { platform: "test", settings: {} } });
  try {
    const id = w.proposal();
    const page = textOf(await w.rita.page(`/portal/proposals/${id}`));
    assert.match(page, /If I accept, take me straight to pay the \$500\.00 deposit by card/);
    assert.match(page, /the invoice for the \$500\.00 to start is in your portal straight away/);
    const answered = await w.rita.post(`/portal/proposals/${id}/answer`, { decision: "accepted", typedName: "Rita Okafor", payNow: "1" });
    const [deposit] = w.deposits();
    assert.deepEqual([deposit?.status, deposit?.total_minor], ["sent", 50000]);
    assert.equal(new URL(answered.headers.get("location") ?? "", w.t.origin).pathname, `/portal/invoices/${deposit?.id}/pay`);
    assert.equal(said(w.t, answered, "done"), "Thank you. Your answer is recorded. Now the deposit:");
    const step = await w.rita.get(`/portal/invoices/${deposit?.id}/pay`);
    assert.match(textOf(await step.text()), /\$500\.00/);
    await w.rita.post((step.headers.get("refresh") ?? "").slice("0;url=".length), { answer: "pay" });
    assert.equal(said(w.t, await w.rita.get(`/portal/invoices/${deposit?.id}/paid`), "done"), "Paid. Thank you.");
    const project = w.t.db.prepare("select payment_status from project_finance pf join invoice i on i.project_id = pf.project_id where i.id = ?").get(deposit?.id as Id);
    assert.equal(project?.["payment_status"], "deposit-paid");
    const sent = events(w.t.db).find((one) => one.action === "invoice.sent-on-acceptance");
    assert.equal(sent?.actor ?? null, null, "the client's acceptance sent it, not a person");
  } finally {
    await w.t.stop();
  }
});

test("card payments on, but pay later: the deposit is sent and waits in the portal with Pay by card", async () => {
  const w = await world({ cardPay: { platform: "test", settings: {} } });
  try {
    const id = w.proposal();
    const answered = await w.rita.post(`/portal/proposals/${id}/answer`, { decision: "accepted", typedName: "Rita Okafor" });
    assert.equal(new URL(answered.headers.get("location") ?? "", w.t.origin).pathname, `/portal/proposals/${id}`);
    const [deposit] = w.deposits();
    assert.equal(deposit?.status, "sent");
    assert.match(await w.rita.page("/portal"), new RegExp(`action="/portal/invoices/${deposit?.id}/pay"`));
    // Declining sends nothing.
    const other = w.proposal();
    await w.rita.post(`/portal/proposals/${other}/answer`, { decision: "declined", typedName: "Rita Okafor", payNow: "1" });
    assert.equal(w.deposits().length, 1);
  } finally {
    await w.t.stop();
  }
});

test("card payments off: the deposit stays a draft for a person to send, and the page doesn't offer to pay", async () => {
  const w = await world({});
  try {
    const id = w.proposal();
    const page = textOf(await w.rita.page(`/portal/proposals/${id}`));
    assert.doesNotMatch(page, /take me straight to pay/);
    assert.match(page, /Potomac Solutions sends an invoice for the \$500\.00 to start/);
    const answered = await w.rita.post(`/portal/proposals/${id}/answer`, { decision: "accepted", typedName: "Rita Okafor", payNow: "1" });
    assert.equal(new URL(answered.headers.get("location") ?? "", w.t.origin).pathname, `/portal/proposals/${id}`);
    assert.equal(w.deposits()[0]?.status, "draft");
  } finally {
    await w.t.stop();
  }
});

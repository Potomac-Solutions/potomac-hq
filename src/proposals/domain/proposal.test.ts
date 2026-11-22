import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { depositFor, formatQuantity, parseLines, parseQuantity, summarize } from "./estimate.ts";
import { decideProposal, editProposal, newProposal, opportunityValue, sectionBlocks, sendProposal, type Proposal } from "./proposal.ts";
import { fromTemplate, TEMPLATE_OPTIONS, TEMPLATES } from "./templates.ts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as Id;
const ids = { id: id(1), opportunityId: id(2), createdBy: id(3) };
const usd = (minor: number) => ({ minor, currency: "USD" as const });

function draft(key = "application"): Proposal {
  const made = newProposal(ids, fromTemplate(key, "Bakery ordering app"));
  assert.ok(made.ok);
  return made.value;
}

test("estimate lines: hours or a quantity times a rate, in whole cents", () => {
  const lines = parseLines([
    { item: "Design", kind: "hours", quantity: "8", rate: "75" },
    { item: "", kind: "hours", quantity: "", rate: "" },
    { item: "Stock photos", kind: "quantity", quantity: "3", rate: "12.50" },
    { item: "Review", kind: "hours", quantity: "0.25", rate: "$75.00" },
  ]);
  assert.ok(lines.ok);
  assert.deepEqual(lines.value.map((l) => [l.item, l.quantity, l.rate.minor, l.total.minor]), [["Design", 800, 7500, 60000], ["Stock photos", 300, 1250, 3750], ["Review", 25, 7500, 1875]]);
  assert.deepEqual(summarize(lines.value), { total: usd(65625), minutes: 495 });
});

test("a line that is half filled in is refused, with a code that says which part", () => {
  const row = { item: "Design", kind: "hours", quantity: "8", rate: "75" };
  assert.deepEqual(parseLines([{ ...row, item: " " }]), { ok: false, error: "line-item-missing" });
  assert.deepEqual(parseLines([{ ...row, kind: "days" }]), { ok: false, error: "line-kind-invalid" });
  assert.deepEqual(parseLines([{ ...row, quantity: "-2" }]), { ok: false, error: "line-quantity-invalid" });
  assert.deepEqual(parseLines([{ ...row, rate: "lots" }]), { ok: false, error: "line-rate-invalid" });
  assert.deepEqual(parseLines(Array(41).fill(row)), { ok: false, error: "too-many-lines" });
  const defaults = parseLines([{ item: "Landing page", kind: "quantity", quantity: "", rate: "" }]);
  assert.ok(defaults.ok);
  assert.deepEqual([defaults.value[0]?.quantity, defaults.value[0]?.total.minor], [100, 0], "an empty quantity is one, an empty rate is nothing");
});

test("quantities read and print the way people write them", () => {
  assert.deepEqual(parseQuantity("1.5"), { ok: true, value: 150 });
  assert.deepEqual(parseQuantity("1.555"), { ok: false, error: "line-quantity-invalid" });
  assert.equal(formatQuantity(150), "1.5");
  assert.equal(formatQuantity(200), "2");
  assert.equal(formatQuantity(25), "0.25");
});

test("a deposit is a third of a fixed quote, rounded up", () => {
  assert.deepEqual(depositFor("fixed", usd(240000)), usd(80000));
  assert.deepEqual(depositFor("fixed", usd(100000)), usd(33334));
  assert.equal(depositFor("monthly", usd(5000)), null);
  assert.equal(depositFor("fixed", usd(0)), null);
});

test("every service has a template whose content is valid as written", () => {
  for (const [key, template] of Object.entries(TEMPLATES)) {
    const made = newProposal(ids, fromTemplate(key, template.label));
    assert.ok(made.ok, key);
    assert.ok(sendProposal(made.value, id(3), "t").ok, `${key} can be sent as it stands`);
  }
  assert.deepEqual(Object.keys(TEMPLATES).sort(), ["application", "automation", "blog", "consulting", "domain-management", "landing-page", "social-media", "website"]);
  assert.equal(TEMPLATE_OPTIONS.at(-1)?.value, "blank");
  assert.deepEqual(fromTemplate("no-such-service", "x").lines, []);
  assert.deepEqual(fromTemplate("constructor", "x").lines, []);
});

test("a draft is sent as version 1, edited into a revision, and sent again as version 2", () => {
  const first = sendProposal(draft(), id(3), "2026-11-16T10:00:00.000Z");
  assert.ok(first.ok);
  assert.deepEqual({ status: first.value.proposal.status, n: first.value.version.number, total: first.value.version.total.minor, minutes: first.value.version.minutes }, { status: "sent", n: 1, total: 240000, minutes: 1920 });
  assert.deepEqual(sendProposal(first.value.proposal, id(3), "t"), { ok: false, error: "already-sent" });

  const revised = editProposal(first.value.proposal, { ...fromTemplate("application", "Bakery ordering app"), lines: [{ item: "Build", kind: "hours", quantity: "20", rate: "75" }] });
  assert.ok(revised.ok);
  assert.equal(revised.value.status, "revised");
  assert.equal(first.value.version.lines.length, 3, "the version that was sent is untouched");
  const second = sendProposal(revised.value, id(3), "2026-11-17T10:00:00.000Z");
  assert.ok(second.ok);
  assert.deepEqual([second.value.version.number, second.value.version.total.minor, second.value.proposal.currentVersion], [2, 150000, 2]);
});

test("what can be sent: lines, and a total that fits the pricing", () => {
  const empty = newProposal(ids, fromTemplate("blank", "Something"));
  assert.ok(empty.ok);
  assert.deepEqual(sendProposal(empty.value, id(3), "t"), { ok: false, error: "no-lines" });
  const freeWithPrice = editProposal(draft("landing-page"), { ...fromTemplate("landing-page", "Page"), lines: [{ item: "Page", kind: "quantity", quantity: "1", rate: "5" }] });
  assert.ok(freeWithPrice.ok);
  assert.deepEqual(sendProposal(freeWithPrice.value, id(3), "t"), { ok: false, error: "free-must-be-zero" });
  const paidWithNothing = editProposal(draft(), { ...fromTemplate("application", "App"), lines: [{ item: "Build", kind: "hours", quantity: "10", rate: "0" }] });
  assert.ok(paidWithNothing.ok);
  assert.deepEqual(sendProposal(paidWithNothing.value, id(3), "t"), { ok: false, error: "total-required" });
});

test("a decision is recorded against the version that was sent, and closes the proposal", () => {
  const answer = { decision: "accepted", byName: " Ann Baker ", on: "2026-11-18", method: "signed-paper", note: "" };
  assert.deepEqual(decideProposal(draft(), answer, id(3), "t"), { ok: false, error: "not-sent" });
  const sent = sendProposal(draft(), id(3), "t1");
  assert.ok(sent.ok);
  const revised = editProposal(sent.value.proposal, fromTemplate("application", "Changed"));
  assert.ok(revised.ok);
  assert.deepEqual(decideProposal(revised.value, answer, id(3), "t"), { ok: false, error: "revised-not-sent" });
  assert.deepEqual(decideProposal(sent.value.proposal, { ...answer, decision: "maybe" }, id(3), "t"), { ok: false, error: "invalid-decision" });
  assert.deepEqual(decideProposal(sent.value.proposal, { ...answer, byName: "" }, id(3), "t"), { ok: false, error: "decided-by-missing" });
  assert.deepEqual(decideProposal(sent.value.proposal, { ...answer, on: "yesterday" }, id(3), "t"), { ok: false, error: "invalid-date" });
  assert.deepEqual(decideProposal(sent.value.proposal, { ...answer, method: "carrier-pigeon" }, id(3), "t"), { ok: false, error: "invalid-method" });

  const accepted = decideProposal(sent.value.proposal, answer, id(3), "t2");
  assert.ok(accepted.ok);
  assert.equal(accepted.value.proposal.status, "accepted");
  assert.deepEqual(accepted.value.decision, { proposalId: id(1), version: 1, decision: "accepted", byName: "Ann Baker", on: "2026-11-18", method: "signed-paper", note: null, recordedBy: id(3), recordedAt: "t2" });
  assert.deepEqual(editProposal(accepted.value.proposal, fromTemplate("application", "x")), { ok: false, error: "closed" });
  assert.deepEqual(sendProposal(accepted.value.proposal, id(3), "t"), { ok: false, error: "closed" });
  assert.deepEqual(decideProposal(accepted.value.proposal, answer, id(3), "t"), { ok: false, error: "closed" });
});

test("the price an opportunity carries: the total, or the hourly rate for hourly work", () => {
  const fixed = sendProposal(draft(), id(3), "t");
  assert.ok(fixed.ok);
  assert.deepEqual(opportunityValue(fixed.value.version), usd(240000));
  const hourly = sendProposal(draft("consulting"), id(3), "t");
  assert.ok(hourly.ok);
  assert.deepEqual(opportunityValue(hourly.value.version), usd(7500));
  const free = sendProposal(draft("landing-page"), id(3), "t");
  assert.ok(free.ok);
  assert.deepEqual(opportunityValue(free.value.version), usd(0));
});

test("a section's lines become paragraphs and bullets", () => {
  assert.deepEqual(sectionBlocks("A custom app.\n\n- Orders\n* Pickup times\n"), [
    { bullet: false, text: "A custom app." },
    { bullet: true, text: "Orders" },
    { bullet: true, text: "Pickup times" },
  ]);
  assert.deepEqual(sectionBlocks("  "), []);
});

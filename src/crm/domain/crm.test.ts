import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import type { Money } from "../../shared/domain/money.ts";
import { activateOnWin, changeClientStatus, newClient } from "./client.ts";
import { newContact } from "./contact.ts";
import { earlierStages, isFollowUpDue, moveStage, newOpportunity, nextStage, setFollowUp, setValue, type Opportunity } from "./opportunity.ts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as Id;
const usd = (minor: number): Money => ({ minor, currency: "USD" });
const at = "2026-11-15T12:00:00.000Z";

function opp(over: Partial<Opportunity> = {}): Opportunity {
  const made = newOpportunity({ id: id(1), organizationId: id(2), ownerId: id(3) }, { title: "Bakery website", leadSource: "word-of-mouth" });
  assert.ok(made.ok);
  return { ...made.value, ...over };
}

// Clients

test("a new client is a trimmed prospect, and a bare domain becomes a website", () => {
  assert.deepEqual(newClient(id(1), { name: "  Mt. Storm Bakery ", sizeTier: "small", website: "mtstormbakery.com", phone: "(304) 555-0100", address: "" }), {
    ok: true,
    value: { id: id(1), name: "Mt. Storm Bakery", status: "prospective", sizeTier: "small", website: "https://mtstormbakery.com/", phone: "(304) 555-0100", address: null, demo: false },
  });
});

test("a client is refused for each bad field, with a code", () => {
  const cases: [Parameters<typeof newClient>[1], string][] = [
    [{ name: " " }, "name-missing"],
    [{ name: "x".repeat(201) }, "name-too-long"],
    [{ name: "A", sizeTier: "huge" }, "invalid-size-tier"],
    [{ name: "A", website: "javascript:alert(1)" }, "invalid-website"],
    [{ name: "A", website: "localhost" }, "invalid-website"],
    [{ name: "A", phone: "call me" }, "invalid-phone"],
    [{ name: "A", phone: "123" }, "invalid-phone"],
    [{ name: "A", address: "x".repeat(501) }, "address-too-long"],
  ];
  for (const [input, error] of cases) assert.deepEqual(newClient(id(1), input), { ok: false, error }, error);
});

test("a client's status is set by hand, and a win makes it active once", () => {
  const made = newClient(id(1), { name: "A" });
  assert.ok(made.ok);
  assert.deepEqual(changeClientStatus(made.value, "prospective"), { ok: false, error: "unchanged" });
  assert.deepEqual(changeClientStatus(made.value, "deleted"), { ok: false, error: "invalid-status" });
  const former = changeClientStatus(made.value, "former");
  assert.ok(former.ok);
  assert.equal(activateOnWin(former.value)?.status, "active");
  assert.equal(activateOnWin({ ...made.value, status: "active" }), null);
});

// Contacts

test("a contact needs a name and an email or a phone", () => {
  assert.deepEqual(newContact(id(1), id(2), { name: "Ann", email: " Ann@Example.COM " }), {
    ok: true,
    value: { id: id(1), organizationId: id(2), name: "Ann", email: "ann@example.com", phone: null, title: null, isPrimary: false },
  });
  assert.deepEqual(newContact(id(1), id(2), { name: "Ann" }), { ok: false, error: "email-or-phone-required" });
  assert.deepEqual(newContact(id(1), id(2), { name: "", email: "a@b.co" }), { ok: false, error: "name-missing" });
  assert.deepEqual(newContact(id(1), id(2), { name: "Ann", email: "ann" }), { ok: false, error: "invalid-email" });
  assert.equal(newContact(id(1), id(2), { name: "Ann", phone: "304-555-0100", isPrimary: true }).ok, true);
});

// Opportunities

test("a new opportunity starts at new, with no price", () => {
  const made = opp();
  assert.equal(made.stage, "new");
  assert.equal(made.value, null);
  assert.deepEqual(newOpportunity({ id: id(1), organizationId: id(2), ownerId: id(3) }, { title: "x", leadSource: "carrier pigeon" }), { ok: false, error: "invalid-lead-source" });
  assert.deepEqual(newOpportunity({ id: id(1), organizationId: id(2), ownerId: id(3) }, { title: "x", leadSource: "phone", service: "magic" }), { ok: false, error: "invalid-service" });
});

test("stages move forward one at a time", () => {
  let o = opp({ service: "website" });
  for (const to of ["consult-booked", "consulted"]) {
    const moved = moveStage(o, to, { at });
    assert.ok(moved.ok, to);
    o = moved.value;
  }
  assert.deepEqual(moveStage(o, "new", { at }), { ok: false, error: "not-the-next-stage" }, "never back unless asked");
  assert.deepEqual(moveStage(o, "won", { at }), { ok: false, error: "not-the-next-stage" });
  assert.deepEqual(moveStage(o, "consulted", { at }), { ok: false, error: "unchanged" });
  assert.deepEqual(moveStage(o, "quoted", { at }), { ok: false, error: "price-required" }, "a quote needs a price");
  const priced = setValue(o, "monthly", usd(5000));
  assert.ok(priced.ok);
  const quoted = moveStage(priced.value, "quoted", { at });
  assert.ok(quoted.ok);
  const won = moveStage(quoted.value, "won", { at });
  assert.ok(won.ok);
  assert.equal(won.value.closedAt, at);
  assert.equal(nextStage(won.value), null);
  assert.deepEqual(moveStage(won.value, "lost", { at, lostReason: "changed mind" }), { ok: false, error: "closed" }, "won can't go straight to lost");
});

test("the service must be known from consulted on", () => {
  const booked = moveStage(opp(), "consult-booked", { at });
  assert.ok(booked.ok);
  assert.deepEqual(moveStage(booked.value, "consulted", { at }), { ok: false, error: "service-required" });
});

test("a free landing page skips the quote", () => {
  const consulted = opp({ service: "landing-page", stage: "consulted" });
  assert.deepEqual(moveStage(consulted, "won", { at }), { ok: false, error: "price-required" });
  const free = setValue(consulted, "free", usd(0));
  assert.ok(free.ok);
  const won = moveStage(free.value, "won", { at });
  assert.ok(won.ok);
  assert.deepEqual(moveStage(opp({ service: "website", stage: "consulted", pricing: "fixed", value: usd(100000) }), "won", { at }), { ok: false, error: "not-the-next-stage" }, "only a landing page skips");
});

test("any open stage can be lost, with a reason", () => {
  assert.deepEqual(moveStage(opp(), "lost", { at }), { ok: false, error: "lost-reason-required" });
  const lost = moveStage(opp(), "lost", { at, lostReason: "  Went with a cousin  " });
  assert.ok(lost.ok);
  assert.equal(lost.value.lostReason, "Went with a cousin");
  assert.equal(lost.value.closedAt, at);
  assert.deepEqual(moveStage(lost.value, "won", { at }), { ok: false, error: "closed" }, "lost can't jump to won");
});

test("a price must fit its pricing shape", () => {
  assert.deepEqual(setValue(opp(), "free", usd(100)), { ok: false, error: "free-must-be-zero" });
  assert.deepEqual(setValue(opp(), "hourly", usd(0)), { ok: false, error: "value-must-be-positive" });
  assert.deepEqual(setValue(opp(), "weekly", usd(100)), { ok: false, error: "invalid-pricing" });
  assert.deepEqual(setValue(opp({ stage: "won", closedAt: at }), "hourly", usd(7500)), { ok: false, error: "closed" });
});

test("a follow-up is a real date, and is due on or after that day while open", () => {
  const set = setFollowUp(opp(), "2026-11-20");
  assert.ok(set.ok);
  assert.equal(isFollowUpDue(set.value, "2026-11-19"), false);
  assert.equal(isFollowUpDue(set.value, "2026-11-20"), true);
  assert.equal(isFollowUpDue(set.value, "2026-12-01"), true);
  assert.equal(isFollowUpDue({ ...set.value, stage: "lost" }, "2026-12-01"), false);
  assert.deepEqual(setFollowUp(opp(), "2026-02-30"), { ok: false, error: "invalid-date" });
  assert.deepEqual(setFollowUp(opp(), "next tuesday"), { ok: false, error: "invalid-date" });
  const cleared = setFollowUp(set.value, "");
  assert.ok(cleared.ok);
  assert.equal(cleared.value.followUpOn, null);
});

test("a person may move an opportunity to any open stage, and reopen won or lost (decision 0014)", () => {
  const quoted = opp({ service: "website", stage: "quoted", pricing: "fixed", value: usd(100000) });
  const back = moveStage(quoted, "new", { at, byHand: true });
  assert.ok(back.ok);
  assert.equal(back.value.stage, "new");
  assert.deepEqual(earlierStages(quoted), ["consulted", "consult-booked", "new"]);
  const undone = moveStage(back.value, "quoted", { at, byHand: true });
  assert.ok(undone.ok, "a person may put it back where it was, skipping ahead");
  assert.deepEqual(moveStage(back.value, "won", { at, byHand: true }), { ok: false, error: "not-the-next-stage" }, "won only from the stage before it");
  assert.deepEqual(earlierStages(opp()), []);

  const won = { ...quoted, stage: "won" as const, closedAt: at };
  assert.deepEqual(moveStage(won, "quoted", { at }), { ok: false, error: "closed" }, "automatic moves never reopen");
  const reopened = moveStage(won, "quoted", { at, byHand: true });
  assert.ok(reopened.ok);
  assert.equal(reopened.value.closedAt, null);
  assert.deepEqual(earlierStages(won), ["quoted", "consulted", "consult-booked", "new"]);

  const lost = moveStage(opp(), "lost", { at, lostReason: "Went with a cousin" });
  assert.ok(lost.ok);
  const reopenedLost = moveStage(lost.value, "new", { at, byHand: true });
  assert.ok(reopenedLost.ok);
  assert.equal(reopenedLost.value.lostReason, null);
  assert.equal(reopenedLost.value.closedAt, null);
  assert.deepEqual(moveStage(lost.value, "won", { at, byHand: true }), { ok: false, error: "closed" }, "lost can't jump to won");
  assert.deepEqual(moveStage(lost.value, "quoted", { at, byHand: true }), { ok: false, error: "service-required" }, "reopening still checks the stage's needs");
});

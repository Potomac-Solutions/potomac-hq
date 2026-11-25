import assert from "node:assert/strict";
import { test } from "node:test";
import { billed, billedThisTerm, billFor, changePrice, newRenewal, occurrences, payBy, renewed, stateOf, yearly } from "./renewal.ts";
import type { Id } from "../../shared/domain/id.ts";

const ids = { id: "11111111-1111-4111-8111-111111111111" as Id, organizationId: "22222222-2222-4222-8222-222222222222" as Id };

test("a renewal is checked; cost and price are optional", () => {
  const made = newRenewal(ids, { kind: "domain", name: " feedstore.com ", provider: "Cloudflare", renewsOn: "2027-01-15", termMonths: "12", cost: "10.44", price: "25", autoRenews: true });
  assert.ok(made.ok);
  assert.deepEqual([made.value.name, made.value.cost?.minor, made.value.price?.minor, made.value.autoRenews], ["feedstore.com", 1044, 2500, true]);
  assert.equal(newRenewal(ids, { kind: "domain", name: "x", renewsOn: "2027-01-15", termMonths: "12" }).ok, true);
  assert.deepEqual(newRenewal(ids, { kind: "boat", name: "x", renewsOn: "2027-01-15", termMonths: "12" }), { ok: false, error: "invalid-kind" });
  assert.deepEqual(newRenewal(ids, { kind: "domain", name: "x", renewsOn: "2027-01-15", termMonths: "7" }), { ok: false, error: "invalid-term" });
  assert.deepEqual(newRenewal(ids, { kind: "domain", name: "x", renewsOn: "2027-01-15", termMonths: "12", cost: "ten" }), { ok: false, error: "not-an-amount" });
});

test("renewing moves the date on one term from when it was due; the state says how soon", () => {
  const made = newRenewal(ids, { kind: "hosting", name: "Shared hosting", renewsOn: "2027-01-31", termMonths: "1", cost: "12", price: "30" });
  assert.ok(made.ok);
  assert.equal(renewed(made.value).renewsOn, "2027-02-28");
  assert.equal(stateOf(made.value, "2027-02-01"), "overdue");
  assert.equal(stateOf(made.value, "2027-01-01"), "soon");
  assert.equal(stateOf(made.value, "2026-12-01"), "later");
  assert.deepEqual(yearly(made.value), { cost: 14400, price: 36000 });
  assert.deepEqual(yearly({ ...made.value, termMonths: 24 }), { cost: 600, price: 1500 });
});

test("a renewal billed to the client is paid a week before it renews, once a term", () => {
  const made = newRenewal({ id: "0190a000-0000-7000-8000-0000000000d1" as Id, organizationId: "0190a000-0000-7000-8000-0000000000d2" as Id }, { kind: "domain", name: "betterdaystowing.com", provider: "Namecheap", renewsOn: "2026-12-02", termMonths: "12", cost: "11.28", price: "20" });
  assert.ok(made.ok);
  assert.equal(payBy(made.value), "2026-11-25");
  const bill = billFor(made.value, "2026-11-23");
  assert.ok(bill.ok);
  assert.deepEqual(bill.value, { description: "betterdaystowing.com: domain renewal from December 2, 2026 (every year)", amount: { minor: 2000, currency: "USD" }, dueOn: "2026-11-25" });
  assert.deepEqual(billFor(made.value, "2026-11-28").ok && billFor(made.value, "2026-11-28"), { ok: true, value: { ...bill.value, dueOn: "2026-11-28" } }, "billed late, it is due today");

  const sent = billed(made.value, "0190a000-0000-7000-8000-0000000000d3" as Id);
  assert.equal(billedThisTerm(sent), true);
  assert.deepEqual(billFor(sent, "2026-11-23"), { ok: false, error: "already-billed" });
  const next = renewed(sent);
  assert.equal(next.renewsOn, "2027-12-02");
  assert.equal(billedThisTerm(next), false, "renewed, the next term is not billed yet");
  assert.ok(billFor(next, "2027-11-01").ok);

  const ours = newRenewal({ id: "0190a000-0000-7000-8000-0000000000d4" as Id, organizationId: "0190a000-0000-7000-8000-0000000000d2" as Id }, { kind: "hosting", name: "Shared hosting", renewsOn: "2026-12-02", termMonths: "1", cost: "5" });
  assert.ok(ours.ok);
  assert.deepEqual(billFor(ours.value, "2026-11-23"), { ok: false, error: "not-billed-to-client" });
});

test("a price change keeps what it was; each time a renewal comes up in a span", () => {
  const made = newRenewal(ids, { kind: "domain", name: "x.com", renewsOn: "2026-12-02", termMonths: "12", price: "25" });
  assert.ok(made.ok);
  const changed = changePrice(made.value, "30", "2026-11-25");
  assert.ok(changed.ok);
  assert.deepEqual([changed.value.price?.minor, changed.value.priceChange], [3000, { was: { minor: 2500, currency: "USD" }, on: "2026-11-25" }]);
  assert.deepEqual(changePrice(made.value, "25.00", "2026-11-25"), { ok: false, error: "same-price" });
  assert.deepEqual(changePrice(made.value, "lots", "2026-11-25"), { ok: false, error: "not-an-amount" });
  assert.deepEqual(occurrences({ renewsOn: "2026-12-02", termMonths: 3 }, "2026-11-25", "2027-11-24"), ["2026-12-02", "2027-03-02", "2027-06-02", "2027-09-02"]);
  assert.deepEqual(occurrences({ renewsOn: "2026-01-15", termMonths: 12 }, "2026-11-25", "2027-11-24"), ["2027-01-15"], "a past date moves on to the next term");
});

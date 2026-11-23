import assert from "node:assert/strict";
import { test } from "node:test";
import { newRenewal, renewed, stateOf, yearly } from "./renewal.ts";
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

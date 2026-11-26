import assert from "node:assert/strict";
import { test } from "node:test";
import { readIntake } from "./intake.ts";

test("the intake: a business name at least, trimmed answers, known accounts only", () => {
  const read = readIntake({ businessName: "  Better Days Towing ", hours: "Mon-Fri 8-6\r\nSat 9-1", access: ["domain", "facebook", "myspace"], email: "" });
  assert.ok(read.ok);
  assert.equal(read.ok && read.value.businessName, "Better Days Towing");
  assert.equal(read.ok && read.value.hours, "Mon-Fri 8-6\nSat 9-1");
  assert.deepEqual(read.ok && read.value.access, ["domain", "facebook"]);
  assert.deepEqual(readIntake({ businessName: " " }), { ok: false, error: "business-name-missing" });
  assert.deepEqual(readIntake({ businessName: "x", tagline: "y".repeat(161) }), { ok: false, error: "too-long:tagline" });
  assert.deepEqual(readIntake({ businessName: "x", email: "not an email" }), { ok: false, error: "invalid-email" });
});

test("never a password, however it's typed", () => {
  for (const said of ["password: hunter2", "GoDaddy pw=abc123", "pass - towing1", "Passcode: 4411"]) assert.deepEqual(readIntake({ businessName: "x", accessNote: said }), { ok: false, error: "looks-like-a-password" }, said);
  assert.ok(readIntake({ businessName: "x", accessNote: "I'll add you on GoDaddy; I forgot my password last week." }).ok);
});

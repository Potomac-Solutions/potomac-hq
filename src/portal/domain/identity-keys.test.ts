import assert from "node:assert/strict";
import { test } from "node:test";
import { emailKey, phoneKey } from "./identity-keys.ts";

test("an email matches without case, a +tag, or Gmail's dots", () => {
  assert.equal(emailKey(" Dale@Example.com "), "dale@example.com");
  assert.equal(emailKey("dale+second@example.com"), "dale@example.com");
  assert.equal(emailKey("D.ale+2@GoogleMail.com"), "dale@gmail.com");
  assert.equal(emailKey("d.ale@example.com"), "d.ale@example.com", "dots count outside Gmail");
  assert.equal(emailKey("nope"), null);
  assert.equal(emailKey("+x@example.com"), null);
  assert.equal(emailKey(null), null);
});

test("a phone matches on its last ten digits", () => {
  assert.equal(phoneKey("(304) 555-0134"), "3045550134");
  assert.equal(phoneKey("+1 304.555.0134"), "3045550134");
  assert.equal(phoneKey("555-0134"), null);
  assert.equal(phoneKey(""), null);
});

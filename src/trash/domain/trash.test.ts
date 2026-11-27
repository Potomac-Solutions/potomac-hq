import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESS_OFF, describeCounts, rowsIn } from "./trash.ts";

test("what goes with a record is named for people, leaving out the record itself", () => {
  assert.equal(describeCounts({ client_organization: 1, contact: 2, task: 1, site_qr_code: 3 }, "client_organization"), "2 contacts, 1 task and 3 other records");
  assert.equal(describeCounts({ contact: 1 }, "contact"), "nothing else");
});

test("a contact's portal access turned off is said, not counted as a record", () => {
  assert.equal(describeCounts({ contact: 1, [ACCESS_OFF]: 1 }, "contact"), "their portal access here (turned off)");
  assert.equal(describeCounts({ contact: 1, note: 2, [ACCESS_OFF]: 2 }, "contact"), "2 notes and portal access here for 2 people (turned off)");
  assert.equal(rowsIn({ contact: 1, note: 2, [ACCESS_OFF]: 1 }), 3);
});

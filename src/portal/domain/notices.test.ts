import assert from "node:assert/strict";
import { test } from "node:test";
import { clientEmail, staffEmail, staffSentence } from "./notices.ts";

const line = { who: "Dale Hinkle", organization: "Hinkle Family Farm", did: "sent a file on Farm stand website", path: "/projects/p1#client-files" };

test("one thing from a client is the subject, and several are counted", () => {
  assert.equal(staffSentence(line), "Dale Hinkle (Hinkle Family Farm) sent a file on Farm stand website.");
  assert.equal(staffSentence({ ...line, organization: "" }), "Dale Hinkle sent a file on Farm stand website.");
  const one = staffEmail("Mikey", [line], "https://hq.example");
  assert.equal(one.subject, "Dale Hinkle sent a file on Farm stand website");
  assert.match(one.body, /^Hi Mikey,\n\nA client did something in the portal:\n\n- Dale Hinkle \(Hinkle Family Farm\) sent a file on Farm stand website\.\n {2}https:\/\/hq\.example\/projects\/p1#client-files\n\nPotomac HQ$/);
  const two = staffEmail("Mikey", [line, { ...line, did: "asked for a call", path: "/clients/c1#portal" }], "https://hq.example");
  assert.equal(two.subject, "2 things from clients in Potomac HQ");
  assert.ok(staffEmail("Mikey", [{ ...line, did: "x".repeat(400) }], "https://hq.example").subject.length <= 150);
});

test("a client's email lists each kind of thing once and how to stop the emails", () => {
  const email = clientEmail({ name: "Dale", organization: "Hinkle Family Farm", kinds: ["An invoice", "An update on your project", "An invoice"], publicUrl: "https://hq.example", phone: "" });
  assert.equal(email.subject, "Something new from Potomac Solutions");
  assert.equal((email.body.match(/- An invoice/g) ?? []).length, 1);
  assert.match(email.body, /https:\/\/hq\.example\/portal\n/);
  assert.match(email.body, /To stop these emails, sign in and turn them off at the bottom of the page\./);
  assert.doesNotMatch(email.body, /Rather talk/);
  assert.match(clientEmail({ name: "Dale", organization: "Farm", kinds: ["An invoice"], publicUrl: "https://hq.example", phone: "304-555-0142" }).body, /Rather talk\? Call 304-555-0142\./);
});

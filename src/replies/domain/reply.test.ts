import { test } from "node:test";
import assert from "node:assert/strict";
import { fillReply, readReply } from "./reply.ts";

test("a reply needs a title and some text", () => {
  assert.deepEqual(readReply({ title: "  Proof   ready ", body: " Hi {first name}\r\n" }), { ok: true, value: { title: "Proof ready", body: "Hi {first name}" } });
  assert.equal(readReply({ title: "", body: "x" }).ok, false);
  assert.equal(readReply({ title: "x", body: " " }).ok, false);
});

test("placeholders are filled where it's used, and left when there's nothing to fill", () => {
  assert.equal(fillReply("Hi {First Name}, {client}'s {project} is ready. {me}", { firstName: "Stacy", client: "Better Days Towing", project: "Towing site", me: "Mikey" }), "Hi Stacy, Better Days Towing's Towing site is ready. Mikey");
  assert.equal(fillReply("Hi {first name}", {}), "Hi {first name}");
});

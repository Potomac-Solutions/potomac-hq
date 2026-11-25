import assert from "node:assert/strict";
import { test } from "node:test";
import { demoEmail, demoFields, isAutomated, isLinkCode, linkCode } from "./demo.ts";

test("a demo needs a name and an https address; its sign-in keeps its lines", () => {
  assert.deepEqual(demoFields({ name: " Counter ", url: "https://counter.potomac.solutions", description: "A parts counter", signIn: "owner@counter.demo\r\ndemo1234" }), { ok: true, value: { name: "Counter", url: "https://counter.potomac.solutions", description: "A parts counter", signIn: "owner@counter.demo\ndemo1234" } });
  assert.deepEqual(demoFields({ name: "", url: "https://x.com" }), { ok: false, error: "name-missing" });
  assert.deepEqual(demoFields({ name: "A", url: "http://counter.potomac.solutions" }), { ok: false, error: "url-invalid" });
});

test("a link code is eight easy letters and digits", () => {
  const code = linkCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.equal(code, "abcdefgh");
  assert.ok(isLinkCode(code));
  assert.equal(isLinkCode("ABC12345"), false);
  assert.equal(isLinkCode("abc"), false);
});

test("previews and crawlers aren't someone looking", () => {
  assert.equal(isAutomated("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)"), false);
  assert.equal(isAutomated("Slackbot-LinkExpanding 1.0"), true);
  assert.equal(isAutomated(""), true);
});

test("the email lists each demo with its own link and sign-in", () => {
  const mail = demoEmail({ firstName: "Rita", note: "Great talking today!", demos: [{ name: "Counter", description: "A parts counter", link: "https://hq.example/d/abcdefgh", signIn: "owner@counter.demo\ndemo1234" }, { name: "Outfitter", description: "", link: "https://hq.example/d/hgfedcba", signIn: "" }] });
  assert.equal(mail.subject, "Demos to try: Counter and Outfitter");
  assert.match(mail.body, /^Hi Rita,\n\nGreat talking today!\n\nHere are some demos/);
  assert.match(mail.body, /Counter: A parts counter\nhttps:\/\/hq\.example\/d\/abcdefgh\nSign in with:\nowner@counter\.demo\ndemo1234\n\nOutfitter\nhttps:\/\/hq\.example\/d\/hgfedcba\n/);
  assert.equal(demoEmail({ firstName: "", note: "", demos: [{ name: "Counter", description: "", link: "x", signIn: "" }] }).subject, "A demo to try: Counter");
});

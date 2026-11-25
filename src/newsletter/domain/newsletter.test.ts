import assert from "node:assert/strict";
import { test } from "node:test";
import { afterSignUp, audienceText, cleanEmail, inAudience, issueEmail, issueFields, signUpFields, stopFrom, type Subscriber } from "./newsletter.ts";
import type { Id } from "../../shared/domain/id.ts";

const someone: Subscriber = { id: "11111111-1111-4111-8111-111111111111" as Id, email: "rita@example.com", emailHash: "h", name: "Rita", stop: "lakes", status: "pending", source: "site", confirmedAt: null, unsubscribedAt: null, createdAt: "2026-11-25T12:00:00Z" };

test("the stop comes from where the website says they were; anything else is the site in general", () => {
  assert.equal(stopFrom("stop:lakes"), "lakes");
  assert.equal(stopFrom(" Enterprise "), "enterprise");
  assert.equal(stopFrom("lab:counter"), "general");
  assert.equal(stopFrom(""), "general");
  assert.equal(stopFrom("stop:<script>"), "general");
});

test("a sign-up needs an email; a name is optional and short", () => {
  assert.deepEqual(signUpFields({ email: " Rita@Example.COM ", name: "  Rita   Okafor " }), { ok: true, value: { email: "rita@example.com", name: "Rita Okafor" } });
  assert.deepEqual(signUpFields({ email: "rita@example.com" }), { ok: true, value: { email: "rita@example.com", name: null } });
  assert.deepEqual(signUpFields({ email: "not an email" }), { ok: false, error: "email-invalid" });
  assert.deepEqual(signUpFields({ email: "rita@example.com", name: "x".repeat(81) }), { ok: false, error: "name-too-long" });
  assert.equal(cleanEmail(`${"a".repeat(250)}@b.co`), null);
});

test("signing up again: a new link while pending, nothing when already on, a fresh start after leaving", () => {
  assert.equal(afterSignUp(null), "new");
  assert.equal(afterSignUp(someone), "resend");
  assert.equal(afterSignUp({ ...someone, status: "subscribed" }), "already");
  assert.equal(afterSignUp({ ...someone, status: "unsubscribed", email: null }), "again");
});

test("an issue needs a subject and words; its stops are kept in order, and all of them means everyone", () => {
  assert.deepEqual(issueFields({ subject: " Winter  hours ", body: "Hi all\r\nNews.", stops: ["lakes", "mountains", "lakes"] }), { ok: true, value: { subject: "Winter hours", body: "Hi all\nNews.", stops: ["mountains", "lakes"] } });
  assert.deepEqual(issueFields({ subject: "A", body: "B", stops: ["mountains", "lakes", "roadside", "history", "enterprise", "general"] }), { ok: true, value: { subject: "A", body: "B", stops: [] } });
  assert.deepEqual(issueFields({ subject: "", body: "B", stops: [] }), { ok: false, error: "subject-missing" });
  assert.deepEqual(issueFields({ subject: "A", body: " ", stops: [] }), { ok: false, error: "body-missing" });
  assert.deepEqual(issueFields({ subject: "A", body: "B", stops: ["moon"] }), { ok: false, error: "invalid-stop" });
  assert.deepEqual(issueFields({ subject: "x".repeat(121), body: "B", stops: [] }), { ok: false, error: "subject-too-long" });
});

test("who an issue reaches", () => {
  assert.equal(audienceText([]), "Everyone");
  assert.equal(audienceText(["lakes", "history"]), "Lakes and outdoors, History and the arts");
  assert.equal(inAudience([], someone), true);
  assert.equal(inAudience(["lakes"], someone), true);
  assert.equal(inAudience(["history"], someone), false);
});

test("every email ends with why they get it, a one-click way out and the mailing address", () => {
  const mail = issueEmail({ subject: "Winter hours", body: "Hello from Gormania.\n\n" }, { unsubscribeUrl: "https://hq.example/river/unsubscribe?t=abc", address: "PO Box 1, Gormania, WV 26720" });
  assert.equal(mail.subject, "Winter hours");
  assert.equal(mail.body, "Hello from Gormania.\n\n—\nYou’re getting Notes from the river because you signed up at potomac.solutions.\nUnsubscribe with one click: https://hq.example/river/unsubscribe?t=abc\nPotomac Solutions · PO Box 1, Gormania, WV 26720");
});

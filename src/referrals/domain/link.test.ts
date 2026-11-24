import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { cleanCode, cleanDestination, codeFrom, editedLink, isAutomated, landingFor, newLink, successRate } from "./link.ts";

const ids = { id: "0190a000-0000-7000-8000-000000000001" as Id, createdBy: "0190a000-0000-7000-8000-000000000002" as Id };

test("a code is lower-case letters, digits and hyphens, two to 32 long", () => {
  assert.equal(cleanCode(" Card-2026 "), "card-2026");
  assert.equal(cleanCode("ab"), "ab");
  for (const bad of ["", "a", "-card", "card-", "my card", "card/1", "çard", "a".repeat(33)]) assert.equal(cleanCode(bad), null, bad);
});

test("a made-up code is six characters that are hard to misread", () => {
  const code = codeFrom(new Uint8Array([0, 1, 2, 250, 251, 252]));
  assert.match(code, /^[a-hjkmnp-z2-9]{6}$/);
  assert.equal(cleanCode(code), code);
});

test("a destination is an https address or one of HQ's own pages", () => {
  assert.deepEqual(cleanDestination("potomac.solutions"), { ok: true, value: "https://potomac.solutions/" });
  assert.deepEqual(cleanDestination("https://potomac.solutions/work?from=card#top"), { ok: true, value: "https://potomac.solutions/work?from=card#top" });
  assert.deepEqual(cleanDestination("/contact"), { ok: true, value: "/contact" });
  for (const bad of ["", "http://potomac.solutions", "javascript:alert(1)", "https://user:pw@potomac.solutions", "https://localhost", "//evil.example", "/r/card", "/contact page", `https://potomac.solutions/${"a".repeat(300)}`]) assert.equal(cleanDestination(bad).ok, false, bad);
});

test("a link needs a label, a code and a destination; editing keeps the code", () => {
  const made = newLink(ids, { code: "Card", label: " Business cards ", destination: "potomac.solutions" });
  assert.deepEqual(made, { ok: true, value: { ...ids, code: "card", label: "Business cards", destination: "https://potomac.solutions/" } });
  assert.deepEqual(newLink(ids, { code: "card", label: " ", destination: "potomac.solutions" }), { ok: false, error: "label-missing" });
  assert.deepEqual(newLink(ids, { code: "card", label: "x".repeat(121), destination: "potomac.solutions" }), { ok: false, error: "label-too-long" });
  assert.deepEqual(newLink(ids, { code: "c", label: "Cards", destination: "potomac.solutions" }), { ok: false, error: "code-invalid" });
  assert.deepEqual(newLink(ids, { code: "card", label: "Cards", destination: "ftp://x.example" }), { ok: false, error: "destination-invalid" });
  if (!made.ok) return;
  const edited = editedLink(made.value, { label: "Cards, 2027", destination: "/book" });
  assert.deepEqual(edited, { ok: true, value: { ...made.value, label: "Cards, 2027", destination: "/book" } });
});

test("a scan lands on the destination carrying the code", () => {
  const link = { ...ids, code: "card", label: "Cards", destination: "https://potomac.solutions/work?from=print#top" };
  assert.equal(landingFor(link), "https://potomac.solutions/work?from=print&ref=card#top");
  assert.equal(landingFor({ ...link, destination: "https://potomac.solutions/?ref=old" }), "https://potomac.solutions/?ref=card");
  assert.equal(landingFor({ ...link, destination: "/contact" }), "/contact?ref=card");
  assert.equal(landingFor({ ...link, destination: "/book?x=1#times" }), "/book?x=1&ref=card#times");
});

test("link previews and crawlers are not scans; phones are", () => {
  for (const agent of ["", "Slackbot-LinkExpanding 1.0", "facebookexternalhit/1.1", "Mozilla/5.0 (compatible; Googlebot/2.1)", "curl/8.5.0", "WhatsApp/2.23", "UptimeRobot/2.0"]) assert.equal(isAutomated(agent), true, agent);
  for (const agent of ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"]) assert.equal(isAutomated(agent), false, agent);
});

test("the success rate reads as a sentence", () => {
  assert.equal(successRate(0, 0), "No scans yet");
  assert.equal(successRate(1, 0), "0 of 1 scan led to an inquiry (0%)");
  assert.equal(successRate(40, 3), "3 of 40 scans led to an inquiry (7.5%)");
  assert.equal(successRate(8, 2), "2 of 8 scans led to an inquiry (25%)");
  assert.equal(successRate(0, 1), "1 inquiry, no scans counted");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { caseStudyFields, checkShot, reviewFields, shotAlt, stars } from "./showcase.ts";

test("a review has 1 to 5 stars, a few words and a name to show", () => {
  assert.deepEqual(reviewFields({ rating: "5", text: " They built our site in a week. ", displayName: " Rita  M. ", town: "Gormania", source: "client" }), { ok: true, value: { rating: 5, text: "They built our site in a week.", displayName: "Rita M.", town: "Gormania", source: "client" } });
  assert.deepEqual(reviewFields({ rating: "6", text: "x", displayName: "x", source: "client" }), { ok: false, error: "rating-invalid" });
  assert.deepEqual(reviewFields({ rating: "4.5", text: "x", displayName: "x", source: "client" }), { ok: false, error: "rating-invalid" });
  assert.deepEqual(reviewFields({ rating: "5", text: " ", displayName: "x", source: "client" }), { ok: false, error: "text-missing" });
  assert.deepEqual(reviewFields({ rating: "5", text: "x", displayName: "", source: "client" }), { ok: false, error: "name-missing" });
  assert.deepEqual(reviewFields({ rating: "5", text: "x", displayName: "x", source: "yelp" }), { ok: false, error: "invalid-source" });
  assert.equal(stars(4), "★★★★☆");
});

test("a case study needs a headline; its address is https and its place 1 to 999", () => {
  assert.deepEqual(caseStudyFields({ headline: "Towing calls, answered", problem: "Calls missed", built: "A site", result: "More calls", liveUrl: "https://betterdaystowing.com", position: "1" }), { ok: true, value: { headline: "Towing calls, answered", problem: "Calls missed", built: "A site", result: "More calls", liveUrl: "https://betterdaystowing.com", position: 1 } });
  assert.equal((caseStudyFields({ headline: "A" }) as { value: { position: number } }).value.position, 100);
  assert.deepEqual(caseStudyFields({ headline: "" }), { ok: false, error: "headline-missing" });
  assert.deepEqual(caseStudyFields({ headline: "A", liveUrl: "http://x.com" }), { ok: false, error: "url-invalid" });
  assert.deepEqual(caseStudyFields({ headline: "A", position: "0" }), { ok: false, error: "position-invalid" });
});

test("a screenshot is a picture by its bytes, and has words for those who can't see it", () => {
  assert.deepEqual(checkShot(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), { ok: true, value: "image/png" });
  assert.deepEqual(checkShot(new TextEncoder().encode("<svg>")), { ok: false, error: "shot-not-a-picture" });
  assert.deepEqual(checkShot(null), { ok: false, error: "shot-missing" });
  assert.deepEqual(shotAlt(" "), { ok: false, error: "alt-missing" });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTouch, funnel, rate, sourceOf, type LeadRow } from "./source.ts";

test("what the website sends is kept when it's sensible and dropped when it isn't, never refused", () => {
  assert.deepEqual(cleanTouch({ src: " Stop:Lakes ", path: "/stops/lakes?x=1#top", utmSource: " facebook ", utmMedium: "cpc", utmCampaign: "Spring  2027" }), { src: "stop:lakes", path: "/stops/lakes", utmSource: "facebook", utmMedium: "cpc", utmCampaign: "Spring 2027" });
  assert.deepEqual(cleanTouch({ src: "<script>", path: "javascript:alert(1)", utmSource: "x".repeat(81) }), null);
  assert.deepEqual(cleanTouch({ path: "//evil.example/x", src: "planner" }), { src: "planner", path: "", utmSource: "", utmMedium: "", utmCampaign: "" });
  assert.equal(cleanTouch({}), null);
});

test("each lead reads as one line of the report", () => {
  const base = { leadSource: "website", src: "", utmSource: "", referralCode: null };
  assert.deepEqual(sourceOf({ ...base, src: "stop:lakes" }), { key: "stop:lakes", label: "River stop: Lakes and outdoors" });
  assert.deepEqual(sourceOf({ ...base, src: "lab:front-desk" }), { key: "lab:front-desk", label: "Lab demo: Front Desk" });
  assert.deepEqual(sourceOf({ ...base, src: "work:better-days-towing" }), { key: "work:better-days-towing", label: "Work page: Better Days Towing" });
  assert.deepEqual(sourceOf({ ...base, src: "planner" }), { key: "planner", label: "The 60-second planner" });
  assert.deepEqual(sourceOf({ ...base, src: "blog:winter-hours" }), { key: "blog", label: "The blog" });
  assert.deepEqual(sourceOf({ ...base, src: "newsletter" }), { key: "newsletter", label: "Notes from the river" });
  assert.deepEqual(sourceOf({ ...base, src: "stop:moon" }), { key: "stop:moon", label: "Website: stop:moon" });
  assert.deepEqual(sourceOf({ ...base, referralCode: "card" }), { key: "referral-link", label: "Referral link (QR code)" });
  assert.deepEqual(sourceOf({ ...base, utmSource: "Facebook" }), { key: "utm:facebook", label: "Campaign: Facebook" });
  assert.deepEqual(sourceOf(base), { key: "source:website", label: "Website, page unknown" });
  assert.deepEqual(sourceOf({ ...base, leadSource: "word-of-mouth" }), { key: "source:word-of-mouth", label: "Word of mouth" });
});

test("the funnel counts leads, calls, proposals and wins for each source, busiest first", () => {
  const row = (over: Partial<LeadRow>): LeadRow => ({ leadSource: "website", src: "", utmSource: "", referralCode: null, hadCall: false, proposalSent: false, won: false, wonMinor: 0, ...over });
  const lines = funnel([row({ src: "stop:lakes", hadCall: true, proposalSent: true, won: true, wonMinor: 150000 }), row({ src: "stop:lakes", hadCall: true }), row({ src: "stop:lakes" }), row({ leadSource: "phone", hadCall: true })]);
  assert.deepEqual(lines, [
    { key: "stop:lakes", label: "River stop: Lakes and outdoors", leads: 3, calls: 2, proposals: 1, won: 1, wonMinor: 150000 },
    { key: "source:phone", label: "Phone", leads: 1, calls: 1, proposals: 0, won: 0, wonMinor: 0 },
  ]);
  assert.equal(rate(1, 3), "33%");
  assert.equal(rate(0, 0), "");
});

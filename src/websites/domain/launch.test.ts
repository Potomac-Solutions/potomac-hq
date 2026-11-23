import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanSiteAddress, describeLaunch, isOpen, isPreviewKey, launchBlock, launchFrom, LIVE, opensFields, opensText, previewLink, readLaunch } from "./launch.ts";

const ZONE = "America/New_York";
const NOW = "2026-11-23T21:00:00Z";
const NEW_YEAR = "2027-01-01T05:00:00Z";

test("coming soon opens at a day and time in the business's time zone: midnight on New Year's Day is 5 AM UTC", () => {
  assert.deepEqual(launchFrom({ mode: "coming-soon", opensOn: "2027-01-01", opensTime: "00:00", message: "  See you\nsoon. " }, ZONE, NOW), { ok: true, value: { mode: "coming-soon", opensAt: NEW_YEAR, message: "See you soon." } });
  assert.deepEqual(launchFrom({ mode: "maintenance", opensOn: "2027-07-04", opensTime: "08:30" }, ZONE, NOW), { ok: true, value: { mode: "maintenance", opensAt: "2027-07-04T12:30:00Z", message: "" } });
  assert.deepEqual(launchFrom({ mode: "coming-soon", opensOn: "", opensTime: "" }, ZONE, NOW), { ok: true, value: { mode: "coming-soon", opensAt: null, message: "" } });
});

test("live has no opening time and no message, whatever was typed", () => {
  assert.deepEqual(launchFrom({ mode: "live", opensOn: "2027-01-01", opensTime: "00:00", message: "x" }, ZONE, NOW), { ok: true, value: LIVE });
});

test("an opening time must be whole, real, and still ahead", () => {
  const soon = { mode: "coming-soon" };
  assert.deepEqual(launchFrom({ mode: "open" }, ZONE, NOW), { ok: false, error: "mode-invalid" });
  assert.deepEqual(launchFrom({ ...soon, opensOn: "2027-01-01" }, ZONE, NOW), { ok: false, error: "opens-time-missing" });
  assert.deepEqual(launchFrom({ ...soon, opensTime: "09:00" }, ZONE, NOW), { ok: false, error: "opens-invalid" });
  assert.deepEqual(launchFrom({ ...soon, opensOn: "2027-02-30", opensTime: "09:00" }, ZONE, NOW), { ok: false, error: "opens-invalid" });
  assert.deepEqual(launchFrom({ ...soon, opensOn: "1/1/27", opensTime: "09:00" }, ZONE, NOW), { ok: false, error: "opens-invalid" });
  // 2:30 AM on March 14, 2027 does not exist in New York: the clocks go from 2 to 3.
  assert.deepEqual(launchFrom({ ...soon, opensOn: "2027-03-14", opensTime: "02:30" }, ZONE, NOW), { ok: false, error: "opens-invalid" });
  assert.deepEqual(launchFrom({ ...soon, opensOn: "2026-11-23", opensTime: "15:59" }, ZONE, NOW), { ok: false, error: "opens-past" });
  assert.deepEqual(launchFrom({ ...soon, opensOn: "2026-11-23", opensTime: "16:00" }, ZONE, NOW), { ok: false, error: "opens-past" });
  assert.equal(launchFrom({ ...soon, opensOn: "2026-11-23", opensTime: "16:01" }, ZONE, NOW).ok, true);
  assert.deepEqual(launchFrom({ ...soon, message: "x".repeat(201) }, ZONE, NOW), { ok: false, error: "status-message-too-long" });
});

test("a site is open when it is live, or its opening time has come", () => {
  const soon = { mode: "coming-soon" as const, opensAt: NEW_YEAR, message: "" };
  assert.equal(isOpen(LIVE, NOW), true);
  assert.equal(isOpen(soon, NOW), false);
  assert.equal(isOpen(soon, "2027-01-01T04:59:59Z"), false);
  assert.equal(isOpen(soon, NEW_YEAR), true);
  assert.equal(isOpen({ ...soon, opensAt: null }, "2030-01-01T00:00:00Z"), false, "with no time, it waits for someone");
});

test("the status reads as a sentence, and the time as someone would type it", () => {
  const soon = { mode: "coming-soon" as const, opensAt: NEW_YEAR, message: "" };
  assert.equal(opensText(NEW_YEAR, ZONE), "Friday, January 1, 2027 at 12:00 AM");
  assert.deepEqual(opensFields(soon, ZONE), { opensOn: "2027-01-01", opensTime: "00:00" });
  assert.deepEqual(opensFields(LIVE, ZONE), { opensOn: "", opensTime: "" });
  assert.equal(describeLaunch(LIVE, ZONE, NOW), "Open to everyone.");
  assert.equal(describeLaunch(soon, ZONE, NOW), "Visitors see “Coming soon”. It opens by itself on Friday, January 1, 2027 at 12:00 AM.");
  assert.equal(describeLaunch(soon, ZONE, "2027-01-02T00:00:00Z"), "Open to everyone. It opened by itself on Friday, January 1, 2027 at 12:00 AM.");
  assert.equal(describeLaunch({ mode: "maintenance", opensAt: null, message: "" }, ZONE, NOW), "Visitors see “Closed for maintenance” until someone opens it.");
});

test("the site's file gets the status and only the preview key's hash; read back, it is the same status", () => {
  const soon = { mode: "coming-soon" as const, opensAt: NEW_YEAR, message: "See you soon." };
  const block = launchBlock(soon, ZONE, "abc123");
  assert.deepEqual(block, { mode: "coming-soon", opensAt: NEW_YEAR, timeZone: ZONE, message: "See you soon.", previewKeyHash: "abc123" });
  assert.deepEqual(launchBlock(LIVE, ZONE, "abc123"), { mode: "live" });
  assert.deepEqual(readLaunch(JSON.stringify({ launch: block })), soon);
  assert.deepEqual(readLaunch(JSON.stringify({ launch: { mode: "maintenance" } })), { mode: "maintenance", opensAt: null, message: "" });
  for (const odd of ["{}", "not json", '{"launch":"soon"}', '{"launch":{"mode":"closed"}}', '{"launch":{"mode":"coming-soon","opensAt":"tomorrow"}}']) assert.deepEqual(readLaunch(odd), LIVE, odd);
});

test("a site's address is https and public; its preview link carries the key", () => {
  assert.deepEqual(cleanSiteAddress("nufinishcollision.com/"), { ok: true, value: "https://nufinishcollision.com" });
  assert.deepEqual(cleanSiteAddress(" https://nu-finish.pages.dev "), { ok: true, value: "https://nu-finish.pages.dev" });
  assert.deepEqual(cleanSiteAddress(""), { ok: true, value: "" });
  for (const bad of ["http://nufinish.example", "https://localhost", "https://a.example/?x=1", "https://user:pw@a.example", "https://a.example:8443", "javascript:alert(1)"]) assert.deepEqual(cleanSiteAddress(bad), { ok: false, error: "address-invalid" }, bad);
  assert.equal(previewLink("https://nufinishcollision.com", "0123456789abcdef0123456789abcdef"), "https://nufinishcollision.com/?preview=0123456789abcdef0123456789abcdef");
  assert.equal(isPreviewKey("0123456789abcdef0123456789abcdef"), true);
  assert.equal(isPreviewKey("../../x"), false);
});

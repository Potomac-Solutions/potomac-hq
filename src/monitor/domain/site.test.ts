import assert from "node:assert/strict";
import { test } from "node:test";
import { afterCheck, cleanSiteUrl, lasted, uptime, type Site } from "./site.ts";
import type { Id } from "../../shared/domain/id.ts";

const site: Site = { id: "11111111-1111-4111-8111-111111111111" as Id, organizationId: "22222222-2222-4222-8222-222222222222" as Id, url: "https://feedstore.com/", active: true, state: "unknown", failures: 0, downSince: null, lastCheckedAt: null, lastResult: "", certExpiresOn: null, certWarnedFor: null };
const good = { ok: true, detail: "200 in 210 ms", certExpiresOn: "2027-03-01" };
const bad = { ok: false, detail: "HTTP 503", certExpiresOn: null };

test("addresses are made safe to check: public http or https only", () => {
  assert.deepEqual(cleanSiteUrl("feedstore.com"), { ok: true, value: "https://feedstore.com/" });
  assert.deepEqual(cleanSiteUrl(" http://Elk-Diner.com/menu#top "), { ok: true, value: "http://elk-diner.com/menu" });
  for (const no of ["ftp://feedstore.com", "https://user:pw@feedstore.com", "https://feedstore.com:8080", "not a url at all"]) assert.equal(cleanSiteUrl(no).ok, false, no);
  for (const inside of ["http://localhost", "http://127.0.0.1", "http://10.0.0.5", "http://[::1]", "http://hq.railway.internal", "http://printer.local", "http://intranet"]) assert.deepEqual(cleanSiteUrl(inside), { ok: false, error: "url-not-public" }, inside);
});

test("down after two failed checks in a row, alerted once; up again after one good one", () => {
  const one = afterCheck({ ...site, state: "up" }, bad, "2026-11-22T10:00:00Z", "2026-11-22");
  assert.deepEqual([one.site.state, one.site.failures, one.changes], ["up", 1, []], "one slow answer is not an alarm");
  const two = afterCheck(one.site, bad, "2026-11-22T10:05:00Z", "2026-11-22");
  assert.equal(two.site.state, "down");
  assert.equal(two.site.downSince, "2026-11-22T10:05:00Z");
  assert.deepEqual(two.changes, [{ kind: "down", reason: "HTTP 503" }]);
  assert.deepEqual(afterCheck(two.site, bad, "2026-11-22T10:10:00Z", "2026-11-22").changes, [], "no second alarm");
  const back = afterCheck(two.site, good, "2026-11-22T11:20:00Z", "2026-11-22");
  assert.deepEqual([back.site.state, back.site.failures, back.site.downSince], ["up", 0, null]);
  assert.deepEqual(back.changes, [{ kind: "up", downSince: "2026-11-22T10:05:00Z" }]);
});

test("a certificate is flagged once, two weeks before it runs out", () => {
  const soon = { ...good, certExpiresOn: "2026-12-01" };
  const first = afterCheck(site, soon, "2026-11-22T10:00:00Z", "2026-11-22");
  assert.deepEqual(first.changes, [{ kind: "cert", expiresOn: "2026-12-01" }]);
  assert.deepEqual(afterCheck(first.site, soon, "2026-11-22T10:05:00Z", "2026-11-22").changes, []);
  assert.deepEqual(afterCheck(first.site, { ...good, certExpiresOn: "2027-03-01" }, "2026-11-23T10:00:00Z", "2026-11-23").changes, [], "renewed: nothing to say");
});

test("how long an outage lasted, and the share of time up", () => {
  assert.equal(lasted("2026-11-22T10:05:00Z", "2026-11-22T11:20:00Z"), "1 h 15 min");
  assert.equal(lasted("2026-11-20T10:00:00Z", "2026-11-22T14:00:00Z"), "2 days 4 h");
  const from = "2026-11-01T00:00:00Z";
  const to = "2026-11-31T00:00:00Z".replace("11-31", "12-01");
  assert.equal(uptime([], from, to), "100%");
  assert.equal(uptime([{ start: "2026-11-10T00:00:00Z", end: "2026-11-10T07:12:00Z" }], from, to), "99.00%");
  assert.equal(uptime([{ start: "2026-10-31T23:00:00Z", end: "2026-11-01T01:00:00Z" }], from, to), "99.86%", "only the part inside the window");
});

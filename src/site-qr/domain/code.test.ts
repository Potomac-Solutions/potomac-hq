import { test } from "node:test";
import assert from "node:assert/strict";
import { addressOf, cleanCode, cleanPage, codeFrom, isAutomated, newCode, originsOf, trackingScript, whenReported } from "./code.ts";
import type { Id } from "../../shared/domain/id.ts";

const ids = { id: "00000000-0000-4000-8000-000000000001" as Id, organizationId: "00000000-0000-4000-8000-000000000002" as Id };
const SITE = "https://betterdaystowing.com";

test("a code is 2 to 32 lower-case letters, digits and hyphens", () => {
  assert.equal(cleanCode(" Card-Spring "), "card-spring");
  assert.equal(cleanCode("a"), null);
  assert.equal(cleanCode("-card"), null);
  assert.equal(cleanCode("card spring"), null);
  assert.equal(codeFrom(new Uint8Array([0, 1, 2, 3, 30, 31])).length, 6);
});

test("a page is a path on the chosen site, never another site, and loses any ref of its own", () => {
  assert.equal(cleanPage("", SITE), "/");
  assert.equal(cleanPage("services", SITE), "/services");
  assert.equal(cleanPage("/towing?area=garrett&ref=old#call", SITE), "/towing?area=garrett#call");
  assert.equal(cleanPage("https://www.betterdaystowing.com/about", SITE), "/about");
  assert.equal(cleanPage("https://example.com/about", SITE), null);
  assert.equal(cleanPage("//example.com", SITE), null);
  assert.equal(cleanPage("/<script>", SITE), null);
});

test("a client's sites are https origins, each host once", () => {
  assert.deepEqual(originsOf(["https://betterdaystowing.com/", "http://www.betterdaystowing.com/x", "https://moats.potomac.solutions", "not a url", "https://localhost"]), ["https://betterdaystowing.com", "https://moats.potomac.solutions"]);
});

test("a code holds the page on the client's own site, with the code as ref", () => {
  const made = newCode(ids, { code: "card", label: "Business cards", site: "", page: "/towing?area=garrett#call" }, [SITE]);
  assert.ok(made.ok);
  assert.equal(addressOf(made.value), "https://betterdaystowing.com/towing?area=garrett&ref=card#call");
  assert.equal(addressOf({ site: SITE, page: "/", code: "flyer" }), "https://betterdaystowing.com/?ref=flyer");
});

test("a code must be on one of the client's sites, and say what it's printed on", () => {
  const sites = [SITE, "https://moats.potomac.solutions"];
  assert.deepEqual(newCode(ids, { code: "card", label: "Cards", site: "", page: "/" }, sites), { ok: false, error: "site-invalid" });
  assert.deepEqual(newCode(ids, { code: "card", label: "Cards", site: "https://evil.example", page: "/" }, sites), { ok: false, error: "site-invalid" });
  assert.deepEqual(newCode(ids, { code: "card", label: " ", site: SITE, page: "/" }, sites), { ok: false, error: "label-missing" });
  assert.equal(newCode(ids, { code: "card", label: "Cards", site: "https://moats.potomac.solutions", page: "" }, sites).ok, true);
});

test("a report kept while HQ was down keeps its time, within a week", () => {
  const now = "2026-11-27T15:00:00Z";
  const twoDaysAgo = Temporal.Instant.from(now).subtract({ hours: 48 });
  assert.equal(whenReported(String(twoDaysAgo.epochMilliseconds), now), twoDaysAgo.toString());
  assert.equal(whenReported(String(Temporal.Instant.from(now).subtract({ hours: 24 * 8 }).epochMilliseconds), now), now);
  assert.equal(whenReported(String(Temporal.Instant.from(now).add({ hours: 1 }).epochMilliseconds), now), now);
  assert.equal(whenReported("soon", now), now);
});

test("programs aren't people", () => {
  assert.equal(isAutomated("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1"), false);
  assert.equal(isAutomated("facebookexternalhit/1.1"), true);
  assert.equal(isAutomated(""), true);
});

test("the script reports to HQ's hook and loads nothing", () => {
  const script = trackingScript("https://hq.potomac.solutions/hooks/site-qr");
  assert.match(script, /"https:\/\/hq\.potomac\.solutions\/hooks\/site-qr"/);
  assert.doesNotMatch(script, /<script src/);
  assert.match(script, /replaceState/);
});

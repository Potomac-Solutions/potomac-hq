import { test } from "node:test";
import assert from "node:assert/strict";
import { HUBS, matchPlaces, navHubs, placeAt, PLACES } from "./places.ts";

test("every place has a unique key and address, and belongs to a hub", () => {
  const keys = new Set(PLACES.map((place) => place.key));
  const hrefs = new Set(PLACES.map((place) => place.href));
  assert.equal(keys.size, PLACES.length);
  assert.equal(hrefs.size, PLACES.length);
  const hubs = new Set(HUBS.map((hub) => hub.key));
  for (const place of PLACES) assert.ok(hubs.has(place.hub), place.key);
});

test("an address belongs to the place that matches it longest", () => {
  assert.equal(placeAt(PLACES, "/")?.key, "home");
  assert.equal(placeAt(PLACES, "/settings/ai")?.key, "ai-settings");
  assert.equal(placeAt(PLACES, "/settings")?.key, "settings");
  assert.equal(placeAt(PLACES, "/opportunities/abc")?.key, "pipeline");
  assert.equal(placeAt(PLACES, "/calls/hours")?.key, "hours");
  assert.equal(placeAt(PLACES, "/phone/123")?.key, "calls");
  assert.equal(placeAt(PLACES, "/nowhere"), null);
});

test("the hub of the page you're on is open, with its page current; others are folded", () => {
  const hubs = navHubs(PLACES, "/invoices/1");
  const money = hubs.find((hub) => hub.key === "money");
  assert.equal(money?.open, true);
  assert.equal(money?.links.find((link) => link.current)?.href, "/money");
  assert.equal(hubs.filter((hub) => hub.open).length, 1);
});

test("hidden pages stay out of the sidebar; on one, the listed page it sits under is current", () => {
  const hubs = navHubs(PLACES, "/calls/hours");
  const clients = hubs.find((hub) => hub.key === "clients");
  assert.equal(clients?.open, true);
  assert.ok(!clients?.links.some((link) => link.href === "/calls/hours"));
  assert.equal(clients?.links.find((link) => link.current)?.href, "/calls");
  assert.equal(navHubs(PLACES, "/clients/import").find((hub) => hub.open)?.links.find((link) => link.current)?.href, "/clients");
});

test("only Home is a hub of one link; a hub left with one other page still folds", () => {
  const hubs = navHubs(PLACES.filter((place) => place.hub !== "money" || place.key === "renewals"), "/");
  assert.equal(hubs.find((hub) => hub.key === "home")?.single, true);
  assert.equal(hubs.find((hub) => hub.key === "money")?.single, false);
});

test("a hub with no page the viewer may open is left out", () => {
  const hubs = navHubs(PLACES.filter((place) => place.hub !== "growth"), "/");
  assert.ok(!hubs.some((hub) => hub.key === "growth"));
});

test("extra links follow their place, and a given address can be marked current instead", () => {
  const hubs = navHubs(PLACES, "/work", { extra: { work: [{ label: "Mine", href: "/work?mine=1", current: false }] }, currentHref: "/work?mine=1" });
  const work = hubs.find((hub) => hub.key === "work");
  const labels = work?.links.map((link) => link.label) ?? [];
  assert.equal(labels[labels.indexOf("All work") + 1], "Mine");
  assert.deepEqual(work?.links.filter((link) => link.current).map((link) => link.href), ["/work?mine=1"]);
});

test("pages are found by the words people use", () => {
  assert.equal(matchPlaces(PLACES, "where do I set my hours")[0]?.key, "hours");
  assert.equal(matchPlaces(PLACES, "booking links")[0]?.key, "calls");
  assert.equal(matchPlaces(PLACES, "dark mode")[0]?.key, "settings");
  assert.equal(matchPlaces(PLACES, "Invoices")[0]?.key, "money");
  assert.equal(matchPlaces(PLACES, "n8n")[0]?.key, "automations");
  assert.equal(matchPlaces(PLACES, "newsletter")[0]?.key, "newsletter");
  assert.deepEqual(matchPlaces(PLACES, "where is the"), []);
  assert.deepEqual(matchPlaces(PLACES, "xyzzy"), []);
});

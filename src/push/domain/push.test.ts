import { test } from "node:test";
import assert from "node:assert/strict";
import { alertDecision, callAlert, deviceLabel, eventAlert, noticeAlert, readDevice } from "./push.ts";

const KEY = "B".repeat(87);

test("a device is an https endpoint and its two keys", () => {
  assert.equal(readDevice({ endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: KEY, auth: "a".repeat(22), label: " Android,  Chrome " }).ok, true);
  for (const endpoint of ["http://push.example/x", "javascript:alert(1)", "nope"]) assert.equal(readDevice({ endpoint, p256dh: KEY, auth: "a".repeat(22), label: "" }).ok, false, endpoint);
  assert.equal(readDevice({ endpoint: "https://push.example/x", p256dh: "short", auth: "a".repeat(22), label: "" }).ok, false);
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 14) Chrome/130"), "Android, Chrome");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604"), "iPhone, Safari");
});

test("an alert goes, waits out quiet hours, or is dropped once it's old news", () => {
  assert.equal(alertDecision("2026-11-25T20:00:00Z", "2026-11-25T20:01:00Z", false), "send");
  assert.equal(alertDecision("2026-11-25T20:00:00Z", "2026-11-25T20:01:00Z", true), "hold");
  assert.equal(alertDecision("2026-11-25T02:00:00Z", "2026-11-25T20:01:00Z", false), "drop");
});

test("what each says, and where it opens", () => {
  assert.deepEqual(noticeAlert({ id: "n1", kind: "assigned", actorName: "Jayanti", taskTitle: "Fix the map", detail: "" }), { key: "notice:n1", title: "Jayanti gave you “Fix the map”", body: "", url: "/notices/n1" });
  assert.equal(noticeAlert({ id: "n2", kind: "mentioned", actorName: "", taskTitle: "Logo", detail: "@mikey look" }).body, "On “Logo”: @mikey look");
  assert.equal(eventAlert({ id: "e1", action: "site.down", recordId: "s", name: "betterdaystowing.com" })?.title, "Site down: betterdaystowing.com");
  assert.equal(eventAlert({ id: "e2", action: "project.message-received", recordId: "p1", name: "Towing site" })?.url, "/projects/p1#updates");
  assert.equal(eventAlert({ id: "e3", action: "user.signed-in", recordId: "u", name: "" }), null);
  assert.equal(callAlert({ id: "b1", who: "Stacy", when: "3:30 PM" }).url, "/get-ready/b1");
});

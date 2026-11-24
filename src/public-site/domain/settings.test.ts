import assert from "node:assert/strict";
import { test } from "node:test";
import { changeSettings, OPEN_SETTINGS, publicSettings } from "./settings.ts";

test("a new install is open, with no banner", () => {
  assert.equal(OPEN_SETTINGS.mode, "live");
  assert.equal(publicSettings(OPEN_SETTINGS).banner, null);
});

test("settings are checked and tidied; the preview token is left alone", () => {
  const current = { ...OPEN_SETTINGS, previewToken: "keep-me" };
  const made = changeSettings(current, { mode: "coming-soon", title: "  Coming   soon ", message: "We are almost ready.", eta: "", bannerText: "Open house Friday", bannerLinkText: "Details", bannerHref: "/work/" });
  assert.ok(made.ok);
  assert.deepEqual([made.value.mode, made.value.title, made.value.previewToken, publicSettings(made.value).banner?.href], ["coming-soon", "Coming soon", "keep-me", "/work/"]);
});

test("bad modes, long text and unsafe or half-given links are refused", () => {
  assert.deepEqual(changeSettings(OPEN_SETTINGS, { mode: "closed" }), { ok: false, error: "invalid-mode" });
  assert.deepEqual(changeSettings(OPEN_SETTINGS, { mode: "live", message: "x".repeat(401) }), { ok: false, error: "message-too-long" });
  assert.deepEqual(changeSettings(OPEN_SETTINGS, { mode: "live", bannerText: "Hi", bannerLinkText: "Go", bannerHref: "javascript:alert(1)" }), { ok: false, error: "invalid-link" });
  assert.deepEqual(changeSettings(OPEN_SETTINGS, { mode: "live", bannerText: "Hi", bannerLinkText: "Go", bannerHref: "//evil.example" }), { ok: false, error: "invalid-link" });
  assert.deepEqual(changeSettings(OPEN_SETTINGS, { mode: "live", bannerText: "Hi", bannerHref: "https://potomac.solutions/book" }), { ok: false, error: "link-text-missing" });
});

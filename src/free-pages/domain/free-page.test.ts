import assert from "node:assert/strict";
import { test } from "node:test";
import { addressOf, canApprove, cleanRepo, cleanSubdomain, nextRound, repoText, roundsUsedText, roundText } from "./free-page.ts";

test("a subdomain is typed as a name, a label or the whole address; Potomac's own names are kept back", () => {
  assert.deepEqual(cleanSubdomain(" Moats Hardware "), { ok: true, value: "moats-hardware" });
  assert.deepEqual(cleanSubdomain("moats.potomac.solutions"), { ok: true, value: "moats" });
  assert.deepEqual(cleanSubdomain(""), { ok: true, value: null });
  assert.deepEqual(cleanSubdomain("hq"), { ok: false, error: "subdomain-reserved" });
  for (const bad of ["-moats", "moats-", "moats--hw", "moats.hw", "mo@ts", "x".repeat(41)]) assert.deepEqual(cleanSubdomain(bad), { ok: false, error: "subdomain-invalid" }, bad);
  assert.equal(addressOf("moats"), "https://moats.potomac.solutions");
  assert.equal(addressOf(null), "");
});

test("a repository is owner/name, with a branch if it isn't main", () => {
  assert.deepEqual(cleanRepo("Potomac-Solutions/moats-landing"), { ok: true, value: { owner: "Potomac-Solutions", name: "moats-landing", branch: "main" } });
  assert.deepEqual(cleanRepo("https://github.com/Potomac-Solutions/moats-landing.git"), { ok: true, value: { owner: "Potomac-Solutions", name: "moats-landing", branch: "main" } });
  assert.deepEqual(cleanRepo("a/b#site"), { ok: true, value: { owner: "a", name: "b", branch: "site" } });
  assert.deepEqual(cleanRepo(""), { ok: true, value: null });
  for (const bad of ["just-a-name", "a/..", "a/b#../x", "a b/c"]) assert.deepEqual(cleanRepo(bad), { ok: false, error: "repo-invalid" }, bad);
  assert.equal(repoText({ owner: "a", name: "b", branch: "main" }), "a/b");
  assert.equal(repoText({ owner: "a", name: "b", branch: "site" }), "a/b#site");
});

test("four rounds are free, then each one is paid; after approval every round is paid", () => {
  const free = { free: true };
  assert.deepEqual(nextRound({ status: "in-review" }, []), { number: 1, free: true });
  assert.deepEqual(nextRound({ status: "in-review" }, [free, free, free]), { number: 4, free: true });
  assert.deepEqual(nextRound({ status: "in-review" }, [free, free, free, free]), { number: 5, free: false });
  assert.deepEqual(nextRound({ status: "approved" }, [free]), { number: 2, free: false });
  assert.equal(roundsUsedText([free, { free: false }]), "1 of 4 free rounds used");
  assert.equal(canApprove("in-review"), true);
  assert.equal(canApprove("requested"), false);
  assert.equal(canApprove("approved"), false);
});

test("a round says what to change", () => {
  assert.deepEqual(roundText("  Bigger phone number\r\nand our hours "), { ok: true, value: "Bigger phone number\nand our hours" });
  assert.deepEqual(roundText(" "), { ok: false, error: "text-missing" });
  assert.deepEqual(roundText("x".repeat(4001)), { ok: false, error: "text-too-long" });
});

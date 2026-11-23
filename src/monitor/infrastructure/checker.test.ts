import assert from "node:assert/strict";
import { test } from "node:test";
import { httpSiteChecker, isPrivateAddress } from "./checker.ts";

test("private, loopback and link-local addresses are recognised", () => {
  for (const inside of ["10.1.2.3", "127.0.0.1", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1"]) assert.equal(isPrivateAddress(inside), true, inside);
  for (const outside of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700::6810:84e5"]) assert.equal(isPrivateAddress(outside), false, outside);
});

test("a site whose name points inside is not fetched at all", async () => {
  let fetched = false;
  const check = httpSiteChecker({ resolve: async () => ["10.0.0.7"], fetch: (async () => ((fetched = true), new Response("x"))) as typeof fetch, cert: async () => null });
  assert.deepEqual(await check("https://sneaky.example/"), { ok: false, detail: "Not a public address", certExpiresOn: null });
  assert.equal(fetched, false);
});

test("up under 400, down from 400, a timeout said plainly, and the certificate read for https", async () => {
  const answer = (status: number) => httpSiteChecker({ resolve: async () => ["93.184.216.34"], fetch: (async () => new Response("ok", { status })) as typeof fetch, cert: async () => "2027-03-01" });
  const up = await answer(200)("https://feedstore.com/");
  assert.equal(up.ok, true);
  assert.match(up.detail, /^200 in \d+ ms$/);
  assert.equal(up.certExpiresOn, "2027-03-01");
  assert.deepEqual(await answer(503)("http://feedstore.com/"), { ok: false, detail: "HTTP 503", certExpiresOn: null });
  const slow = httpSiteChecker({ resolve: async () => ["93.184.216.34"], fetch: (async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }) as typeof fetch, cert: async () => null });
  assert.equal((await slow("https://feedstore.com/")).detail, "Timed out after 10 seconds");
  const nowhere = httpSiteChecker({ resolve: async () => { throw new Error("ENOTFOUND"); } });
  assert.equal((await nowhere("https://nowhere.example/")).detail, "The name doesn’t resolve");
});

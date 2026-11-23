import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicAddress, outsideFetch } from "./outside-fetch.ts";

test("only addresses on the public internet are public", () => {
  for (const address of ["8.8.8.8", "142.250.72.14", "172.15.0.1", "172.32.0.1", "2607:f8b0:4004:c07::8a"]) assert.equal(isPublicAddress(address), true, address);
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "not-an-address"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("::ffff:8.8.8.8"), true);
});

test("an address that isn't https, or is inside the server's network, is refused before any connection", async () => {
  for (const address of ["http://calendar.example/a.ics", "ftp://calendar.example/a", "https://user:pw@calendar.example/a.ics", "https://calendar.example:8443/a.ics", "nope"]) assert.deepEqual(await outsideFetch(address), { ok: false, error: "address-invalid" }, address);
  for (const address of ["https://127.0.0.1/a.ics", "https://169.254.169.254/latest/meta-data", "https://[::1]/a.ics", "https://10.0.0.5/a.ics", "https://localhost/a.ics", "https://db.internal/a.ics", "https://printer.local/a.ics"]) assert.deepEqual(await outsideFetch(address), { ok: false, error: "address-private" }, address);
});

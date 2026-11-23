// Addresses scanners send looking for files like .env: each one is refused
// or not found, nothing is read from disk, and nothing reaches the error log.
import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, test } from "node:test";
import { testApp, type TestApp } from "../support/harness.ts";

let t: TestApp;
const logged: string[] = [];
before(async () => {
  t = await testApp({ log: (message: string) => logged.push(message) });
});
after(() => t.stop());

/** Sends the address exactly as written: fetch would tidy it first. */
function raw(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: new URL(t.origin).port, path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("an address that doesn't start with one slash, or can't be read, is a bad request", async () => {
  for (const path of ["//%2e%2e%2f%2eenv", "//.env", "//evil.example/x", "//"]) {
    const res = await raw(path);
    assert.equal(res.status, 400, path);
    assert.equal(res.body, "Bad request", path);
  }
});

test("looking for files outside HQ finds nothing", async () => {
  for (const path of ["/.env", "/%2e%2e%2f%2eenv", "/assets/..%2f..%2f.env", "/assets/%2e%2e/%2e%2e/.env", "/assets/../../package.json", "/portal/..%2f.env", "/.git/config"]) {
    const res = await raw(path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.body, /HQ_|BREVO|PRIVATE KEY|\[core\]|"dependencies"/, path);
  }
  assert.deepEqual(logged.filter((line) => line.startsWith("Unhandled error")), []);
});

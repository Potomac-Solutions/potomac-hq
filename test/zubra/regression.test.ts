// The Zubra regression suite (roadmap v1.0). These are the things HQ relies
// on Zubra to do, each of which has broken or could break in an upgrade. Run
// it before and after changing a @zubra version: `npm run test:zubra`. It
// also runs in CI with the integration tests.
//
// When Zubra breaks one of these, file it upstream with the label
// `found-by: potomac` and pin the working version until it is fixed.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import * as crm from "../../src/crm/index.ts";
import type { Id } from "../../src/shared/index.ts";
import { httpClient, signIn, TEST_PASSWORD_COST, testApp, unwrap, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let clientId = "";
const ATTACK = `<img src=x onerror=alert(1)>"'&`;

before(async () => {
  t = await testApp({ passwordCost: TEST_PASSWORD_COST });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as Id;
  clientId = unwrap(crm.createClient(t.services.crm, mikey, { name: ATTACK })).id;
});
after(() => t.stop());

/** A request with the path and Host exactly as given: fetch would tidy both. */
function raw(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; location: string }> {
  const { hostname, port } = new URL(t.origin);
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, location: String(res.headers["location"] ?? "") }));
    });
    req.on("error", reject);
    req.end();
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith(".zb") ? [join(dir, entry.name)] : []));
}
const routes = sourceFiles(join(import.meta.dirname, "..", "..", "src")).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/'use route ([^']+)'/g)].map((match) => match[1] as string));
const fill = (pattern: string) => pattern.replace(/:n\b/, "1").replace(/:slug\b/, "workflow").replace(/:[a-z]+/g, clientId);

test("the installed Zubra packages are the pinned ones, all at one version", () => {
  const root = join(import.meta.dirname, "..", "..");
  const wanted = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies;
  const versions = ["compiler", "router", "runtime", "server"].map((name) => {
    const installed = (JSON.parse(readFileSync(join(root, "node_modules", "@zubra", name, "package.json"), "utf8")) as { version: string }).version;
    assert.equal(installed, wanted[`@zubra/${name}`], `@zubra/${name}`);
    assert.match(wanted[`@zubra/${name}`] ?? "", /^\d+\.\d+\.\d+$/, "pinned exactly, with no range");
    return installed;
  });
  assert.equal(new Set(versions).size, 1, "the four packages move together");
});

test("a guard cannot be walked around with a doubled slash, a trailing slash, or odd capitals (5.17 and 5.18 let some through)", async () => {
  for (const path of ["//clients", "/clients/", "//clients/", "/Clients", "/clients//", "/./clients", "/clients/../clients", `//clients/${clientId}`, "/%63lients", "/clients%2f", "//activity", "//portal", "/settings/"]) {
    const res = await raw(path);
    assert.ok([400, 401, 404, 301, 302, 307, 308].includes(res.status), `${path} answered ${res.status}`);
    assert.doesNotMatch(res.body, /onerror|Mikey Nichols/, `${path} showed records to nobody`);
    if (res.location) assert.match(res.location, /^\/(?!\/)/, `${path} redirects off this site: ${res.location}`);
  }
});

test("a Host header with a path in it changes nothing (5.17 and 5.18 routed by it)", async () => {
  for (const host of ["hq.example/clients", "hq.example/../clients", "evil.example", "hq.example:80/clients?x="]) {
    // Refused outright, or treated as an ordinary signed-out request. Never routed by the header.
    const signedOut = await raw("/", { host });
    assert.ok([400, 401].includes(signedOut.status), `${host} answered ${signedOut.status}`);
    assert.doesNotMatch(signedOut.body, /onerror|Mikey Nichols/, host);
    const missing = await raw("/no-such-page", { host });
    assert.ok([400, 404].includes(missing.status), `${host} answered ${missing.status}`);
  }
});

test("every page is refused to a signed-out visitor, whatever its layout", async () => {
  const stranger = httpClient(t.origin);
  // Open to anyone: asking for a reset, the portal's sign-in and invite pages, booking a call, and a
  // project shared by link (decision 0007, section 11), which is "not found" without a working link,
  // and the newsletter's sign-up and its confirm and unsubscribe pages (decision 0013).
  const open = new Set(["/forgot-password", "/portal/sign-in", "/portal/sign-up", "/portal/accept", "/book", "/book/manage", "/book/with/:token", "/contact", "/contact/thanks", "/s/:token", "/river", "/river/check", "/river/confirm", "/river/thanks", "/river/unsubscribe", "/river/left", "/review", "/review/thanks"]);
  const share = await stranger.get(`/s/${"a".repeat(43)}`);
  assert.equal(share.status, 404, "a made-up share link");
  assert.doesNotMatch(await share.text(), /onerror|Mikey Nichols/);
  assert.ok(routes.length >= 28, `found ${routes.length} pages`);
  for (const pattern of routes) {
    if (open.has(pattern)) continue;
    const res = await stranger.get(fill(pattern));
    assert.equal(res.status, 401, `${pattern} answered ${res.status}`);
    assert.doesNotMatch(await res.text(), /onerror/, pattern);
  }
});

test("text from a record is always escaped: in text, in attributes, in a title, and in lists", async () => {
  for (const path of [`/clients/${clientId}`, "/clients", "/", "/activity"]) {
    const html = await admin.page(path);
    assert.doesNotMatch(html, /<img src=x/, `${path} printed markup from a record`);
    if (path.startsWith("/clients")) assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, path);
  }
  const title = /<title>([^<]*)<\/title>/.exec(await admin.page(`/clients/${clientId}`))?.[1] ?? "";
  assert.match(title, /^&lt;img/, "a title cannot be closed early by a record's text");
  // A value from the address, printed back into a form field.
  const searched = await admin.page(`/knowledge?q=${encodeURIComponent(`"><script>alert(1)</script>`)}`);
  assert.doesNotMatch(searched, /<script>alert\(1\)<\/script>/);
  assert.match(searched, /value="&quot;&gt;&lt;script&gt;/);
});

test("pages carry no inline script and no inline style block, so the content policy can forbid both", async () => {
  for (const path of ["/", "/clients", `/clients/${clientId}`, "/knowledge", "/reports", "/people", "/activity", "/board"]) {
    const html = await admin.page(path);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>\s*\S/, `${path} has an inline script`);
    assert.doesNotMatch(html, /<style[\s>]/, `${path} has an inline style block`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${path} has an inline event handler`);
  }
});

test("a layout is rendered once around a page, and a page's title replaces the layout's", async () => {
  const html = await admin.page("/clients");
  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  assert.equal((html.match(/<hq-app\b/g) ?? []).length, 1);
  assert.equal((html.match(/<user-avatar\b/g) ?? []).length, 1, "issue 300: a component imported by a layout and a page was nested in itself");
  assert.match(html, /<title>Clients[^<]*<\/title>/);
  const portal = await httpClient(t.origin).get("/portal");
  assert.doesNotMatch(await portal.text(), /<hq-app\b/, "the portal's root layout does not sit inside HQ's");
});

test("conditions and lists render on the server: nested lists, an else branch, and a boolean attribute", async () => {
  const people = await admin.page("/people");
  assert.match(people, /<input type="checkbox" name="role-admin" value="1" checked[^>]*>/);
  assert.doesNotMatch(people, /<input type="checkbox" name="role-manager" value="1" checked/);
  assert.doesNotMatch(people, /zb-if|zb-else|zb-each/, "no template instruction is left in the page");
  const empty = await admin.page("/proposals");
  assert.match(empty, /No proposals yet|Nothing/i);
  const notFound = await admin.get("/clients/00000000-0000-4000-8000-000000000000");
  assert.equal(notFound.status, 404);
  assert.match(await notFound.text(), /<main\b/, "the 404 page sits inside the layout");
});

test("a component's own script and stylesheet are served from this origin", async () => {
  const html = await admin.page("/");
  const assets = [...html.matchAll(/(?:src|href)="(\/_zubra\/[^"]+)"/g)].map((match) => match[1] as string);
  assert.ok(assets.length > 0, "the page links its components");
  for (const asset of new Set(assets)) {
    const res = await httpClient(t.origin).get(asset);
    assert.equal(res.status, 200, asset);
    assert.match(res.headers.get("content-type") ?? "", /javascript|css/, asset);
  }
  assert.equal((await httpClient(t.origin).get("/_zubra/../package.json")).status, 404);
});

import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { googleSheetTarget, sheetConfigFrom, tokenRequest } from "./google-sheet.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const config = { spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345", clientEmail: "hq@potomac.iam.gserviceaccount.com", privateKeyPem: privateKey };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("the settings are all or nothing, and the key file is checked", () => {
  assert.equal(sheetConfigFrom({}), null);
  assert.throws(() => sheetConfigFrom({ HQ_SHEETS_SPREADSHEET_ID: config.spreadsheetId }), /partly set up/);
  assert.throws(() => sheetConfigFrom({ HQ_SHEETS_SPREADSHEET_ID: "https://docs.google.com/spreadsheets/d/x", HQ_SHEETS_SERVICE_ACCOUNT: "{}" }), /not the whole address/);
  assert.throws(() => sheetConfigFrom({ HQ_SHEETS_SPREADSHEET_ID: config.spreadsheetId, HQ_SHEETS_SERVICE_ACCOUNT: "not json" }), /as JSON/);
  assert.throws(() => sheetConfigFrom({ HQ_SHEETS_SPREADSHEET_ID: config.spreadsheetId, HQ_SHEETS_SERVICE_ACCOUNT: '{"client_email":"a@b"}' }), /missing client_email or private_key/);
  assert.deepEqual(sheetConfigFrom({ HQ_SHEETS_SPREADSHEET_ID: config.spreadsheetId, HQ_SHEETS_SERVICE_ACCOUNT: JSON.stringify({ client_email: config.clientEmail, private_key: privateKey }) }), config);
});

test("the token request is signed by the service account, for spreadsheets only, for an hour", () => {
  const [header = "", claims = "", signature = ""] = tokenRequest(config, 1_800_000_000).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), {
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: 1_800_000_000,
    exp: 1_800_003_600,
  });
  assert.ok(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, "base64url")));
});

test("a sync signs in, adds missing tabs, clears, then writes every cell as typed", async () => {
  const calls: { url: string; method: string; body: string; auth: string }[] = [];
  const fake = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const address = String(url);
    calls.push({ url: address, method: init.method ?? "GET", body: String(init.body ?? ""), auth: (init.headers as Record<string, string> | undefined)?.["authorization"] ?? "" });
    if (address.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "ya29.test" });
    if (address.includes("?fields=")) return json({ sheets: [{ properties: { title: "Time" } }, { properties: { title: "Sheet1" } }] });
    return json({});
  }) as typeof fetch;
  const target = googleSheetTarget(config, { fetch: fake, now: () => 1_800_000_000_000 });
  await target.replace([
    { name: "Time", rows: [["Date", "Hours", "Note"], ["2026-11-16", 1.5, "=SUM(A1)"]] },
    { name: "Expenses", rows: [["Date", "Amount"], ["2026-11-16", null]] },
  ]);

  assert.deepEqual(calls.map((call) => [call.method, call.url.replace(/^https:\/\/[^/]+/, "")]), [
    ["POST", "/token"],
    ["GET", `/v4/spreadsheets/${config.spreadsheetId}?fields=sheets.properties.title`],
    ["POST", `/v4/spreadsheets/${config.spreadsheetId}:batchUpdate`],
    ["POST", `/v4/spreadsheets/${config.spreadsheetId}/values:batchClear`],
    ["POST", `/v4/spreadsheets/${config.spreadsheetId}/values:batchUpdate`],
  ]);
  assert.match(calls[0]?.body ?? "", /^grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/);
  assert.ok(calls.slice(1).every((call) => call.auth === "Bearer ya29.test"));
  assert.deepEqual(JSON.parse(calls[2]?.body ?? ""), { requests: [{ addSheet: { properties: { title: "Expenses" } } }] }, "only the tab that is missing is added");
  assert.deepEqual(JSON.parse(calls[3]?.body ?? ""), { ranges: ["Time", "Expenses"] });
  assert.deepEqual(JSON.parse(calls[4]?.body ?? ""), {
    valueInputOption: "RAW",
    data: [
      { range: "Time!A1", values: [["Date", "Hours", "Note"], ["2026-11-16", 1.5, "=SUM(A1)"]] },
      { range: "Expenses!A1", values: [["Date", "Amount"], ["2026-11-16", ""]] },
    ],
  });
});

test("a refusal names the step and the status, and nothing secret", async () => {
  const refuse = (async (url: string | URL | Request) => (String(url).includes("oauth2") ? json({ access_token: "ya29.secret-token" }) : json({ error: "no" }, 403))) as typeof fetch;
  await assert.rejects(googleSheetTarget(config, { fetch: refuse }).replace([{ name: "Time", rows: [] }]), (error: Error) => {
    assert.equal(error.message, "Google Sheets read failed: HTTP 403");
    return true;
  });
  const noToken = (async () => json({})) as typeof fetch;
  await assert.rejects(googleSheetTarget(config, { fetch: noToken }).replace([]), /no access token/);
});

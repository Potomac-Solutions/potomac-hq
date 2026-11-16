// The Google Sheet finance records are copied to (docs/tool-boundaries.md:
// "Finance syncs to a Google Sheet"). HQ signs in as a Google service
// account, which the sheet is shared with as an editor. Written to Google's
// published Sheets API v4 and OAuth 2.0 service-account flow.
import { createSign } from "node:crypto";
import type { SheetTarget } from "../application/queries.ts";

export type SheetConfig = {
  readonly spreadsheetId: string;
  /** The service account's address, ending .iam.gserviceaccount.com. */
  readonly clientEmail: string;
  /** Its private key, as PEM text. */
  readonly privateKeyPem: string;
};

/**
 * null when the sheet is not set up. Throws when it is half set up.
 *   HQ_SHEETS_SPREADSHEET_ID    the id in the sheet's address
 *   HQ_SHEETS_SERVICE_ACCOUNT   the service account's key file, as JSON text
 */
export function sheetConfigFrom(env: NodeJS.ProcessEnv): SheetConfig | null {
  const spreadsheetId = env["HQ_SHEETS_SPREADSHEET_ID"];
  const account = env["HQ_SHEETS_SERVICE_ACCOUNT"];
  if (!spreadsheetId && !account) return null;
  if (!spreadsheetId || !account) throw new Error("The finance sheet is partly set up: set both HQ_SHEETS_SPREADSHEET_ID and HQ_SHEETS_SERVICE_ACCOUNT.");
  if (!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) throw new Error("HQ_SHEETS_SPREADSHEET_ID must be the id from the sheet's address, not the whole address.");
  let key: { client_email?: unknown; private_key?: unknown };
  try {
    key = JSON.parse(account) as typeof key;
  } catch {
    throw new Error("HQ_SHEETS_SERVICE_ACCOUNT must be the service account's key file, as JSON.");
  }
  if (typeof key.client_email !== "string" || typeof key.private_key !== "string" || !key.private_key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("HQ_SHEETS_SERVICE_ACCOUNT is missing client_email or private_key.");
  }
  return { spreadsheetId, clientEmail: key.client_email, privateKeyPem: key.private_key };
}

const base64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

/** A signed request for an access token that lasts an hour and can only edit spreadsheets. */
export function tokenRequest(config: SheetConfig, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: config.clientEmail, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(config.privateKeyPem);
  return `${header}.${claims}.${base64url(signature)}`;
}

export function googleSheetTarget(config: SheetConfig, deps: { fetch?: typeof fetch; now?: () => number } = {}): SheetTarget {
  const send = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}`;

  /** Sends one request and returns its JSON. A refusal is an error naming the step and the status, never the key or the token. */
  async function call(step: string, url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await send(url, init);
    if (!response.ok) throw new Error(`Google Sheets ${step} failed: HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }

  return {
    describe: `Google Sheet ${config.spreadsheetId}`,
    async replace(tabs) {
      const granted = await call("sign-in", "https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: tokenRequest(config, Math.floor(now() / 1000)) }).toString(),
      });
      if (typeof granted["access_token"] !== "string") throw new Error("Google Sheets sign-in failed: no access token");
      const headers = { authorization: `Bearer ${granted["access_token"]}`, "content-type": "application/json" };

      // Make any tab that is not there yet.
      const sheet = await call("read", `${api}?fields=sheets.properties.title`, { headers });
      const existing = new Set(((sheet["sheets"] as { properties?: { title?: string } }[] | undefined) ?? []).map((one) => one.properties?.title));
      const missing = tabs.filter((tab) => !existing.has(tab.name));
      if (missing.length > 0) {
        await call("add tabs", `${api}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: missing.map((tab) => ({ addSheet: { properties: { title: tab.name } } })) }) });
      }
      await call("clear", `${api}/values:batchClear`, { method: "POST", headers, body: JSON.stringify({ ranges: tabs.map((tab) => tab.name) }) });
      // RAW: every cell is stored as typed, so text is never read as a formula.
      await call("write", `${api}/values:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ valueInputOption: "RAW", data: tabs.map((tab) => ({ range: `${tab.name}!A1`, values: tab.rows.map((row) => row.map((cell) => cell ?? "")) })) }),
      });
    },
  };
}

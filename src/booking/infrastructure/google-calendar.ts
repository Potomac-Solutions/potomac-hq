// Busy times from a Google Calendar, so a booking never lands on something
// already in it. HQ signs in as a Google service account that the calendar
// is shared with ("See only free/busy"), and asks only for free/busy: it
// never sees what the events are. Written to Google's published Calendar API
// v3 (freeBusy.query) and OAuth 2.0 service-account flow.
import { createSign } from "node:crypto";
import type { BusyCalendar } from "../application/ports.ts";
import type { Busy } from "../domain/hours.ts";

export type CalendarConfig = {
  /** Usually the calendar owner's email address. */
  readonly calendarId: string;
  readonly clientEmail: string;
  readonly privateKeyPem: string;
};

/**
 * null when it is not set up. Throws when it is half set up.
 *   HQ_GOOGLE_CALENDAR_ID               the calendar's id, usually its owner's email
 *   HQ_GOOGLE_SERVICE_ACCOUNT           the service account's key file, as JSON text.
 *                                       If unset, HQ_SHEETS_SERVICE_ACCOUNT is used.
 */
export function calendarConfigFrom(env: NodeJS.ProcessEnv): CalendarConfig | null {
  const calendarId = (env["HQ_GOOGLE_CALENDAR_ID"] ?? "").trim();
  const account = env["HQ_GOOGLE_SERVICE_ACCOUNT"] || env["HQ_SHEETS_SERVICE_ACCOUNT"] || "";
  if (!calendarId) return null;
  if (!account) throw new Error("HQ_GOOGLE_CALENDAR_ID is set but there is no service account: set HQ_GOOGLE_SERVICE_ACCOUNT (or HQ_SHEETS_SERVICE_ACCOUNT).");
  if (calendarId.length > 254 || /\s/.test(calendarId)) throw new Error("HQ_GOOGLE_CALENDAR_ID must be the calendar's id, like you@example.com.");
  let key: { client_email?: unknown; private_key?: unknown };
  try {
    key = JSON.parse(account) as typeof key;
  } catch {
    throw new Error("The Google service account must be its key file, as JSON.");
  }
  if (typeof key.client_email !== "string" || typeof key.private_key !== "string" || !key.private_key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("The Google service account is missing client_email or private_key.");
  }
  return { calendarId, clientEmail: key.client_email, privateKeyPem: key.private_key };
}

const base64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");
const SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";

/** A signed request for an access token that lasts an hour and can only read free/busy. */
export function calendarTokenRequest(config: CalendarConfig, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: config.clientEmail, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(config.privateKeyPem);
  return `${header}.${claims}.${base64url(signature)}`;
}

/**
 * The calendar's busy times. A token is kept until five minutes before it
 * runs out, and an answer for one minute, so pages stay quick. Any refusal
 * is an error naming the step and status, never the key or the token: open
 * times are then not offered, rather than offered wrong.
 */
export function googleBusyCalendar(config: CalendarConfig, deps: { fetch?: typeof fetch; now?: () => number } = {}): BusyCalendar {
  const send = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let token: { value: string; until: number } | null = null;
  let cached: { key: string; until: number; busy: readonly Busy[] } | null = null;

  async function call(step: string, url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await send(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Google Calendar ${step} failed: HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }

  async function accessToken(): Promise<string> {
    if (token && token.until > now()) return token.value;
    const granted = await call("sign-in", "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: calendarTokenRequest(config, Math.floor(now() / 1000)) }).toString(),
    });
    if (typeof granted["access_token"] !== "string") throw new Error("Google Calendar sign-in failed: no access token");
    const seconds = typeof granted["expires_in"] === "number" ? granted["expires_in"] : 3600;
    token = { value: granted["access_token"], until: now() + (seconds - 300) * 1000 };
    return token.value;
  }

  return {
    name: `Google Calendar ${config.calendarId}`,
    async busy(from, to) {
      // The window moves with the clock; round it to the minute so a page and its post share an answer.
      const key = `${from.slice(0, 16)} ${to.slice(0, 16)}`;
      if (cached && cached.key === key && cached.until > now()) return cached.busy;
      const answer = await call("free/busy", "https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ timeMin: from, timeMax: to, timeZone: "UTC", items: [{ id: config.calendarId }] }),
      });
      const calendar = (answer["calendars"] as Record<string, { busy?: { start?: unknown; end?: unknown }[]; errors?: unknown[] }> | undefined)?.[config.calendarId];
      if (!calendar) throw new Error("Google Calendar free/busy failed: the calendar was not in the answer");
      // Not shared with the service account, or not found: Google says so here, not in the status.
      if (calendar.errors && calendar.errors.length > 0) throw new Error("Google Calendar free/busy failed: the calendar is not shared with HQ's service account");
      const busy = (calendar.busy ?? []).flatMap((one) => {
        if (typeof one.start !== "string" || typeof one.end !== "string") return [];
        try {
          return [{ start: Temporal.Instant.from(one.start).toString(), end: Temporal.Instant.from(one.end).toString() }];
        } catch {
          return [];
        }
      });
      cached = { key, until: now() + 60_000, busy };
      return busy;
    },
  };
}

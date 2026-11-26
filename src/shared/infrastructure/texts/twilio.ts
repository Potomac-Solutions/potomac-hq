// Text messages through Twilio's Messages API (2026-11-26). Off unless all
// three settings are present. Twilio answers STOP for us: once someone texts
// STOP, sending to them fails with error 21610, which we read as "stopped".
export type TextResult = { readonly ok: true } | { readonly ok: false; readonly stopped: boolean; readonly reason: string };
export type TextSender = (to: string, body: string) => Promise<TextResult>;

export type TwilioConfig = { readonly accountSid: string; readonly authToken: string; readonly from: string };

/** Twilio's code for a number that has replied STOP. */
const UNSUBSCRIBED = 21610;

export function twilioSender(config: TwilioConfig, deps: { fetch?: typeof fetch } = {}): TextSender {
  const send = deps.fetch ?? fetch;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const auth = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;
  return async (to, body) => {
    const form = new URLSearchParams({ To: to, Body: body });
    // A messaging service (MG…) picks the number itself; otherwise send from the one given.
    form.set(config.from.startsWith("MG") ? "MessagingServiceSid" : "From", config.from);
    const response = await send(url, { method: "POST", headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString() });
    if (response.status === 201 || response.status === 200) return { ok: true };
    let code = 0;
    try {
      code = Number(((await response.json()) as { code?: unknown }).code ?? 0);
    } catch {
      // No body worth reading; the status says enough.
    }
    return { ok: false, stopped: code === UNSUBSCRIBED, reason: code ? `twilio-${code}` : `twilio-http-${response.status}` };
  };
}

/**
 * null when texts are not set up. Throws when they are half set up.
 *   HQ_TWILIO_ACCOUNT_SID  the account (AC…)
 *   HQ_TWILIO_AUTH_TOKEN   its auth token
 *   HQ_TWILIO_FROM         the sending number, like +13045550100, or a messaging service (MG…)
 */
export function textConfigFrom(env: NodeJS.ProcessEnv, deps: { fetch?: typeof fetch } = {}): TextSender | null {
  const accountSid = env["HQ_TWILIO_ACCOUNT_SID"] ?? "";
  const authToken = env["HQ_TWILIO_AUTH_TOKEN"] ?? "";
  const from = env["HQ_TWILIO_FROM"] ?? "";
  if (!accountSid && !authToken && !from) return null;
  if (!accountSid || !authToken || !from) throw new Error("Texts are partly set up: set HQ_TWILIO_ACCOUNT_SID, HQ_TWILIO_AUTH_TOKEN and HQ_TWILIO_FROM.");
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) throw new Error("HQ_TWILIO_ACCOUNT_SID should start AC and be 34 characters.");
  if (!/^(\+1\d{10}|MG[0-9a-f]{32})$/i.test(from)) throw new Error("HQ_TWILIO_FROM should be a US number like +13045550100, or a messaging service (MG…).");
  return twilioSender({ accountSid, authToken, from }, deps);
}

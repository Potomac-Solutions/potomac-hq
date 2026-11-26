// Saving a PayPal account and charging it later (2026-11-26): PayPal's
// Payment Method Tokens v3 API to save without a purchase, then an Orders v2
// order with the saved vault_id. Vaulting has to be turned on for the REST
// app in PayPal's dashboard, and PayPal may need to approve the account for
// it, so this is checked in the sandbox before it's used for real.
import type { SavedPay } from "../application/autopay.ts";

type Json = Record<string, any>;
export type PayPalSavedConfig = { readonly client: string; readonly secret: string; readonly sandbox?: boolean; readonly api?: string };

const decimal = (cents: number) => (cents / 100).toFixed(2);

export function paypalSavedPay(config: PayPalSavedConfig, deps: { readonly fetch?: typeof fetch; readonly now?: () => number } = {}): SavedPay {
  const send = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const base = config.api ?? (config.sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com");
  let token = { value: "", until: 0 };
  async function call(path: string, init: { method?: string; json?: unknown; key?: string } = {}): Promise<{ status: number; data: Json }> {
    if (!token.value || now() >= token.until) {
      const res = await send(`${base}/v1/oauth2/token`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${config.client}:${config.secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
      const data = (await res.json().catch(() => ({}))) as Json;
      if (res.status !== 200 || !data["access_token"]) throw new Error(`paypal-auth-${res.status}`);
      token = { value: data["access_token"], until: now() + Math.max(0, Number(data["expires_in"] ?? 0) - 60) * 1000 };
    }
    const headers: Record<string, string> = { authorization: `Bearer ${token.value}`, accept: "application/json" };
    if (init.json !== undefined) headers["content-type"] = "application/json";
    if (init.key) headers["paypal-request-id"] = init.key.slice(0, 108);
    const res = await send(`${base}${path}`, { method: init.method ?? (init.json === undefined ? "GET" : "POST"), headers, ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }) });
    return { status: res.status, data: res.status === 204 ? {} : ((await res.json().catch(() => ({}))) as Json) };
  }
  const issue = (data: Json, status: number) => String(data["details"]?.[0]?.issue ?? data["name"] ?? `http-${status}`).slice(0, 200);
  const captureOf = (order: Json) => order["purchase_units"]?.[0]?.payments?.captures?.find((one: Json) => one["status"] === "COMPLETED");
  return {
    platform: "paypal",
    async begin({ key, back, cancel }) {
      const { status, data } = await call("/v3/vault/setup-tokens", {
        key,
        json: { payment_source: { paypal: { usage_type: "MERCHANT", experience_context: { brand_name: "Potomac Solutions", return_url: back, cancel_url: cancel, shipping_preference: "NO_SHIPPING" } } } },
      });
      const url = (data["links"] as Json[] | undefined)?.find((link) => link["rel"] === "approve")?.["href"];
      return (status === 200 || status === 201) && data["id"] && url ? { ok: true, setup: String(data["id"]), url: String(url) } : { ok: false, reason: issue(data, status) };
    },
    async keep(setup) {
      const { status, data } = await call("/v3/vault/payment-tokens", { key: `keep:${setup}`, json: { payment_source: { token: { id: setup, type: "SETUP_TOKEN" } } } });
      if ((status !== 200 && status !== 201) || !data["id"]) return { ok: false, reason: issue(data, status) };
      const email = data["payment_source"]?.paypal?.email_address;
      return { ok: true, token: String(data["id"]), label: email ? `PayPal (${email})` : "PayPal" };
    },
    async charge({ token: vault, key, cents, currency, description }) {
      let made: { status: number; data: Json };
      try {
        made = await call("/v2/checkout/orders", {
          key,
          json: { intent: "CAPTURE", purchase_units: [{ description: description.slice(0, 127), amount: { currency_code: currency.toUpperCase(), value: decimal(cents) } }], payment_source: { paypal: { vault_id: vault } } },
        });
      } catch (error) {
        return { outcome: "unknown", reason: error instanceof Error ? error.message.slice(0, 200) : "no answer" };
      }
      const { status, data } = made;
      // A 4xx is a refusal: nothing was taken. A 5xx may or may not have taken it.
      if (status >= 500) return { outcome: "unknown", reason: `paypal-http-${status}` };
      if (status !== 200 && status !== 201) return { outcome: "declined", reason: issue(data, status) };
      let order = data;
      if (order["status"] === "APPROVED" || order["status"] === "CREATED") {
        const taken = await call(`/v2/checkout/orders/${encodeURIComponent(String(order["id"]))}/capture`, { key: `capture:${order["id"]}`, json: {} }).catch(() => null);
        if (!taken || taken.status >= 500) return { outcome: "unknown", reason: "capture-no-answer" };
        if (taken.status !== 200 && taken.status !== 201) return { outcome: "declined", reason: issue(taken.data, taken.status) };
        order = taken.data;
      }
      const capture = captureOf(order);
      if (capture) return { outcome: "paid", reference: String(capture["id"]) };
      const pending = order["purchase_units"]?.[0]?.payments?.captures?.[0];
      if (pending?.status === "DECLINED") return { outcome: "declined", reason: "DECLINED" };
      // Pending, or a shape we don't know: a person should look.
      return { outcome: "unknown", reason: String(pending?.status ?? order["status"] ?? "unclear").slice(0, 200) };
    },
    async forget(vault) {
      const { status } = await call(`/v3/vault/payment-tokens/${encodeURIComponent(vault)}`, { method: "DELETE" });
      return status === 204 || status === 200 || status === 404;
    },
  };
}

/** The saved-method platform for HQ's card pay settings: PayPal only, for now. */
export function savedPayFrom(cardPay: { readonly platform: string; readonly settings: Record<string, Record<string, unknown>> } | null | undefined, deps: { readonly fetch?: typeof fetch } = {}): SavedPay | null {
  if (!cardPay || cardPay.platform !== "paypal") return null;
  const s = cardPay.settings["paypal"] ?? {};
  if (typeof s["client"] !== "string" || typeof s["secret"] !== "string") return null;
  return paypalSavedPay({ client: s["client"], secret: s["secret"], sandbox: s["sandbox"] === true }, deps);
}

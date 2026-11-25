// Outbound email through Brevo's transactional API (decision 0001). This is
// the kit notify module's `send` function: one message in, a code out.
export type SendInput = {
  readonly channel: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  /** Extra headers, such as the newsletter's List-Unsubscribe. */
  readonly headers?: Readonly<Record<string, string>>;
};
export type SendResult = { readonly ok: true } | { readonly error: string };
export type Send = (message: SendInput) => Promise<SendResult>;

export type BrevoConfig = {
  readonly apiKey: string;
  readonly from: { readonly email: string; readonly name: string };
};

export function brevoSender(config: BrevoConfig, deps: { fetch?: typeof fetch } = {}): Send {
  const send = deps.fetch ?? fetch;
  return async (message) => {
    if (message.channel !== "email") return { error: "channel-not-supported" };
    const response = await send("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "api-key": config.apiKey },
      body: JSON.stringify({
        sender: config.from,
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.body,
        ...(message.headers && Object.keys(message.headers).length > 0 ? { headers: message.headers } : {}),
      }),
    });
    // The response may say why; it never needs to carry the key back. Keep the status only.
    return response.status === 201 || response.status === 202 ? { ok: true } : { error: `brevo-http-${response.status}` };
  };
}

export type EmailConfig = { readonly send: Send; readonly publicUrl: string };

/**
 * null when email is not set up. Throws when it is half set up.
 *   HQ_BREVO_API_KEY     the Brevo API key
 *   HQ_EMAIL_FROM        a sending address verified in Brevo, on potomac.solutions
 *   HQ_EMAIL_FROM_NAME   optional, defaults to "Potomac HQ"
 *   HQ_PUBLIC_URL        the address people use, for links in email
 */
export function emailConfigFrom(env: NodeJS.ProcessEnv, deps: { fetch?: typeof fetch } = {}): EmailConfig | null {
  const apiKey = env["HQ_BREVO_API_KEY"];
  const from = env["HQ_EMAIL_FROM"];
  if (!apiKey && !from) return null;
  if (!apiKey || !from) throw new Error("Email is partly set up: set both HQ_BREVO_API_KEY and HQ_EMAIL_FROM.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw new Error("HQ_EMAIL_FROM must be an email address.");
  const publicUrl = env["HQ_PUBLIC_URL"];
  if (!publicUrl || !/^https:\/\//.test(publicUrl)) throw new Error("Email links need HQ_PUBLIC_URL, an https address.");
  return {
    send: brevoSender({ apiKey, from: { email: from, name: env["HQ_EMAIL_FROM_NAME"] || "Potomac HQ" } }, deps),
    publicUrl: publicUrl.replace(/\/$/, ""),
  };
}

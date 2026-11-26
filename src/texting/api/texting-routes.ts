// Turning texts on and off from the portal (2026-11-26).
import { Hono } from "hono";
import { agreeToTexts, stopTexts, type TextingDeps } from "../application/texting.ts";
import { formPosts, type Id } from "../../shared/index.ts";

type Session = { readonly organizationId: Id; readonly clientUserId: Id };
const MESSAGES: Readonly<Record<string, string>> = {
  unavailable: "Texts aren’t available yet.",
  "phone-invalid": "Check the number: a US mobile number, like 304-555-0142.",
  "not-agreed": "Tick the box to say it’s OK to text you.",
  "not-signed-in": "Sign in first.",
};

export function textingRoutes(deps: { readonly texting: TextingDeps; readonly clientOf: (cookieHeader: string) => Session | null; readonly sign: (location: string) => string }): Hono {
  const app = new Hono();
  const post = formPosts<Session | null>(app, { actorOf: deps.clientOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? "That didn’t work.", home: "/portal" });
  post("/portal/texts", (session, form) => (session ? agreeToTexts(deps.texting, session, { phone: form["phone"] ?? "", agree: form["agree"] === "yes" }) : { ok: false, error: "not-signed-in" }), {
    done: () => "/portal#texts",
    back: () => "/portal#texts",
    message: (on) => `Done. We’ll text ${on.phone} reminders of calls and bills. Reply STOP any time.`,
  });
  post("/portal/texts/stop", (session) => (session ? stopTexts(deps.texting, session) : { ok: false, error: "not-signed-in" }), {
    done: () => "/portal#texts",
    back: () => "/portal#texts",
    message: () => "Texts are off. Email reminders carry on as before.",
  });
  return app;
}

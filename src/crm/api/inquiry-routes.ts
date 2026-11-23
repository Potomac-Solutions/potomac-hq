// The inquiry form: anyone, from HQ's own /contact page or a form on
// Potomac's website, sends a message that lands in the CRM. Limited by
// address and email, with a field only bots fill in.
import { Hono } from "hono";
import { recordInquiry, type CrmDeps, type InquiryInput } from "../application/commands.ts";
import { readForm, withMessage, type Id } from "../../shared/index.ts";

export type InquiryRoutesDeps = {
  readonly crm: CrmDeps;
  /** Who owns a new inquiry's opportunity. Null when nobody can: no admin yet. */
  readonly ownerFor: () => Id | null;
  readonly sign: (location: string) => string;
  readonly addressOf: (incoming: unknown) => string;
  readonly allowPerAddress: (key: string) => boolean;
  readonly allowPerEmail: (key: string) => boolean;
  /** Where a form on another site may send people back to: its origins, like https://potomac.solutions. */
  readonly returnOrigins: readonly string[];
  /** Counts the inquiry for the referral link whose code came with the form, if one did. */
  readonly credit?: (code: string, opportunityId: Id) => void;
  /** Tells Potomac's people, after it is saved. Never fails the request. */
  readonly notify: (inquiry: InquiryInput & { readonly opportunityId: Id; readonly known: boolean }) => Promise<void>;
};

const MESSAGES: Readonly<Record<string, string>> = {
  "name-missing": "Enter your name.",
  "name-too-long": "Keep your name under 100 characters.",
  "email-invalid": "Enter your email, like you@example.com.",
  "phone-invalid": "Check the phone number: like 304-555-0142.",
  "business-too-long": "Keep the business name under 120 characters.",
  "message-missing": "Tell us a little about what you need.",
  "message-too-long": "Keep it under 2,000 characters: we’ll talk about the rest.",
  "invalid-service": "Choose from the list, or leave it empty.",
  "too-many": "That’s a lot of messages at once. Call or email instead.",
  closed: "The form isn’t working right now. Call or email instead.",
};

/** A return address on an allowed site, or null. */
function returnTo(raw: string, origins: readonly string[]): string | null {
  try {
    const url = new URL(raw);
    return origins.includes(url.origin) && (url.protocol === "https:" || url.protocol === "http:") ? url.toString() : null;
  } catch {
    return null;
  }
}

export function inquiryRoutes(deps: InquiryRoutesDeps): Hono<{ Bindings: { incoming: unknown } }> {
  const app = new Hono<{ Bindings: { incoming: unknown } }>();
  app.post("/contact", async (c) => {
    const { fields } = await readForm(c);
    const back = returnTo(fields["return_to"] ?? "", deps.returnOrigins);
    const answer = (name: "done" | "problem", message: string) => new Response(null, { status: 303, headers: { location: back ? withMessage(back, name, message) : deps.sign(withMessage(name === "done" ? "/contact/thanks" : "/contact", name, message)) } });
    if ((fields["website"] ?? "") !== "") return answer("done", "Thanks. We’ll be in touch within two business days.");
    const email = (fields["email"] ?? "").trim().toLowerCase();
    if (!deps.allowPerAddress(deps.addressOf(c.env.incoming)) || (email && !deps.allowPerEmail(email))) return answer("problem", MESSAGES["too-many"] as string);
    const owner = deps.ownerFor();
    if (!owner) return answer("problem", MESSAGES["closed"] as string);
    const input: InquiryInput = { name: fields["name"] ?? "", email, phone: fields["phone"] ?? null, business: fields["business"] ?? null, message: fields["message"] ?? "", service: fields["service"] ?? null };
    const made = recordInquiry(deps.crm, owner, input);
    if (!made.ok) return answer("problem", MESSAGES[made.error] ?? "That didn’t work. Try again.");
    // The code a referral link put in the page's address (`ref`), sent on by the form.
    const ref = (fields["ref"] ?? "").trim();
    if (ref && deps.credit) {
      try {
        deps.credit(ref, made.value.opportunityId);
      } catch {
        // The inquiry is saved. Losing its credit must not lose the answer.
      }
    }
    await deps.notify({ ...input, opportunityId: made.value.opportunityId, known: made.value.known }).catch(() => undefined);
    return answer("done", "Thanks. We’ll be in touch within two business days.");
  });
  return app;
}

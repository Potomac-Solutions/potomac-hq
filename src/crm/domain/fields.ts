// Small checks shared by the CRM's records. The ones every module needs live
// in src/shared/domain/fields.ts.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export { calendarDate, optionalEmail, optionalText, requiredText } from "../../shared/domain/fields.ts";

/** Digits, spaces and + ( ) - . only, with at least seven digits. */
export function optionalPhone(value: string | null | undefined): Result<string | null, "invalid-phone"> {
  const text = (value ?? "").trim();
  if (text.length === 0) return ok(null);
  const digits = text.replace(/\D/g, "").length;
  return /^[\d\s+().-]{7,40}$/.test(text) && digits >= 7 ? ok(text) : err("invalid-phone");
}

/** An http or https address. "example.com" is read as https://example.com. */
export function optionalWebsite(value: string | null | undefined): Result<string | null, "invalid-website"> {
  const text = (value ?? "").trim();
  if (text.length === 0) return ok(null);
  if (text.length > 300) return err("invalid-website");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return err("invalid-website");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return err("invalid-website");
  if (!url.hostname.includes(".")) return err("invalid-website");
  return ok(url.href);
}

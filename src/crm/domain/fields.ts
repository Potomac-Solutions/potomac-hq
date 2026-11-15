// Small checks shared by the CRM's records.
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** Trimmed text of at most `max` characters, or null when empty. */
export function optionalText(value: string | null | undefined, max: number): Result<string | null, "too-long"> {
  const text = (value ?? "").trim();
  if (text.length === 0) return ok(null);
  return text.length > max ? err("too-long") : ok(text);
}

/** Trimmed text that must be present. */
export function requiredText(value: string | null | undefined, max: number): Result<string, "missing" | "too-long"> {
  const text = (value ?? "").trim();
  if (text.length === 0) return err("missing");
  return text.length > max ? err("too-long") : ok(text);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function optionalEmail(value: string | null | undefined): Result<string | null, "invalid-email"> {
  const text = (value ?? "").trim().toLowerCase();
  if (text.length === 0) return ok(null);
  return text.length <= 254 && EMAIL.test(text) ? ok(text) : err("invalid-email");
}

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

/** A calendar date as YYYY-MM-DD. */
export function calendarDate(value: string): Result<string, "invalid-date"> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return err("invalid-date");
  try {
    return ok(Temporal.PlainDate.from(value, { overflow: "reject" }).toString());
  } catch {
    return err("invalid-date");
  }
}

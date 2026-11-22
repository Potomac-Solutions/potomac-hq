// Small checks every module's records share: text, email and calendar dates.
import { err, ok, type Result } from "./result.ts";

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

/** A calendar date as YYYY-MM-DD. */
export function calendarDate(value: string): Result<string, "invalid-date"> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return err("invalid-date");
  try {
    return ok(Temporal.PlainDate.from(value, { overflow: "reject" }).toString());
  } catch {
    return err("invalid-date");
  }
}

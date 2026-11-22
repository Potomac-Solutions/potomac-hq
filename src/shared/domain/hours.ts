// Hours as people type them, kept as whole minutes.
import { err, ok, type Result } from "./result.ts";

/** "1.5" → 90. Empty is "none". At most 10,000 hours, never negative. */
export function parseHours(text: string | null | undefined): Result<number | null, "invalid-hours"> {
  const cleaned = (text ?? "").trim();
  if (cleaned === "") return ok(null);
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(cleaned)) return err("invalid-hours");
  const minutes = Math.round(Number(cleaned) * 60);
  return minutes > 600_000 ? err("invalid-hours") : ok(minutes);
}

/**
 * Time that was worked, for reading: 151 → "2 h 31 min", 120 → "2 h", 45 →
 * "45 min", 0 → "0 h". A decimal like "2.52" reads like a clock time, so
 * screens use this. A form that takes hours is filled with formatHours.
 */
export function readableHours(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return rest === 0 ? "0 h" : `${rest} min`;
  return rest === 0 ? `${hours.toLocaleString("en-US")} h` : `${hours.toLocaleString("en-US")} h ${rest} min`;
}

/** 90 → "1.5", 120 → "2", 100 → "1.67". For filling a form, and for estimates people typed. */
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0$/, "");
}

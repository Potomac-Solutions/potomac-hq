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

/** 90 → "1.5", 120 → "2", 100 → "1.67". */
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0$/, "");
}

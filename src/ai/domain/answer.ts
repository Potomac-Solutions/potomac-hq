// Reading what the model answered. Every prompt asks for one JSON object; this
// finds it, and the readers below check each field the way a form would. An
// answer that doesn't fit is refused, never half-used.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type AnswerError = "bad-answer";
export type Fields = { readonly [key: string]: unknown };

/** The JSON object in an answer: the whole text, or the first {...} in it (a model may wrap it in a code fence). */
export function answerObject(text: string): Result<Fields, AnswerError> {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return err("bad-answer");
  try {
    const value: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? ok(value as Fields) : err("bad-answer");
  } catch {
    return err("bad-answer");
  }
}

/** Text, trimmed, with Windows line ends made plain; "" when missing. Null when it's too long or not text. */
export function text(fields: Fields, key: string, max: number): string | null {
  const value = fields[key] ?? "";
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\r\n/g, "\n").trim();
  return cleaned.length <= max ? cleaned : null;
}

/** Text that must be there. */
export function needed(fields: Fields, key: string, max: number): string | null {
  const value = text(fields, key, max);
  return value ? value : null;
}

/** A list of short texts, blanks dropped, at most `count`. Null when it isn't a list of text. */
export function texts(fields: Fields, key: string, max: number, count: number): string[] | null {
  const value = fields[key] ?? [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const one of value) {
    if (typeof one !== "string") return null;
    const cleaned = one.trim();
    if (cleaned.length > max) return null;
    if (cleaned) out.push(cleaned);
  }
  return out.slice(0, count);
}

/** A number from 0 up to `max`, or null when missing or out of range. */
export function amount(fields: Fields, key: string, max: number): number | null {
  const value = fields[key];
  if (typeof value === "string" && /^\$?\d+(\.\d+)?$/.test(value.trim())) return amount({ [key]: Number(value.trim().replace(/^\$/, "")) }, key, max);
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

export const flag = (fields: Fields, key: string): boolean => fields[key] === true;

/** One of a list of words, or null. */
export function oneOf<T extends string>(fields: Fields, key: string, choices: readonly T[]): T | null {
  const value = fields[key];
  return typeof value === "string" && (choices as readonly string[]).includes(value.trim()) ? (value.trim() as T) : null;
}

/** YYYY-MM-DD that is a real day, or null. */
export function day(fields: Fields, key: string): string | null {
  const value = fields[key];
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : null;
}

/** A nested object, or null. */
export function inner(fields: Fields, key: string): Fields | null {
  const value = fields[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

/** A list of objects, at most `count`, or null. */
export function list(fields: Fields, key: string, count: number): Fields[] | null {
  const value = fields[key] ?? [];
  if (!Array.isArray(value)) return null;
  if (value.some((one) => typeof one !== "object" || one === null || Array.isArray(one))) return null;
  return (value as Fields[]).slice(0, count);
}

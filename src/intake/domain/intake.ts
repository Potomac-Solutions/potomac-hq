// The new-client intake (2026-11-26): what a client tells Potomac once, so
// it isn't asked over a week of emails. Never passwords.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const ACCESS_KINDS = ["domain", "hosting", "google-business", "facebook", "instagram", "email"] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number];
export const ACCESS_LABELS: Readonly<Record<AccessKind, string>> = {
  domain: "Where your domain name is registered",
  hosting: "Your current website or hosting",
  "google-business": "Google Business Profile",
  facebook: "Facebook page",
  instagram: "Instagram",
  email: "Business email",
};

/** The same, as Potomac reads them on the client's page. */
export const STAFF_ACCESS_LABELS: Readonly<Record<AccessKind, string>> = { ...ACCESS_LABELS, domain: "Where the domain is registered", hosting: "Their current website or hosting" };

export type IntakeAnswers = {
  readonly businessName: string;
  readonly tagline: string;
  readonly phone: string;
  readonly email: string;
  readonly address: string;
  readonly hours: string;
  readonly about: string;
  readonly colors: string;
  readonly likes: string;
  readonly avoid: string;
  readonly access: readonly AccessKind[];
  readonly accessNote: string;
};

const LIMITS: Readonly<Record<Exclude<keyof IntakeAnswers, "access">, number>> = {
  businessName: 120,
  tagline: 160,
  phone: 40,
  email: 160,
  address: 300,
  hours: 600,
  about: 2000,
  colors: 300,
  likes: 1000,
  avoid: 1000,
  accessNote: 600,
};

export const FIELD_LABELS: Readonly<Record<Exclude<keyof IntakeAnswers, "access">, string>> = {
  businessName: "Business name, as it should appear",
  tagline: "A line about you",
  phone: "Phone customers call",
  email: "Email customers write to",
  address: "Address",
  hours: "Hours",
  about: "About the business",
  colors: "Colors",
  likes: "Sites or looks you like",
  avoid: "Anything to avoid",
  accessNote: "About those accounts",
};

/** The same, as Potomac reads them on the client's page. */
export const STAFF_FIELD_LABELS: typeof FIELD_LABELS = { ...FIELD_LABELS, businessName: "Business name", tagline: "Their line about themselves", likes: "Sites or looks they like" };

export type IntakeError = "business-name-missing" | "too-long" | "looks-like-a-password" | "invalid-email";

/** Text that reads like a login: "password: ...", "pw=...", "pass - ...". */
const PASSWORD = /\b(pass(word|code)?|pwd|pw)\s*[:=\-]\s*\S/i;

/**
 * What was typed, kept so a refused form isn't typed again: cut to length,
 * and any answer that reads like a password emptied (it is never kept).
 * `cleared` names those answers.
 */
export function draftOf(input: Readonly<Record<string, string | readonly string[] | undefined>>): { readonly answers: IntakeAnswers; readonly cleared: readonly string[] } {
  const answers: Record<string, unknown> = {};
  const cleared: string[] = [];
  for (const name of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const value = String(input[name] ?? "").trim().replace(/\r\n/g, "\n").slice(0, LIMITS[name]);
    if (PASSWORD.test(value)) cleared.push(FIELD_LABELS[name]);
    answers[name] = PASSWORD.test(value) ? "" : value;
  }
  const picked = input["access"];
  const list = (Array.isArray(picked) ? picked : picked ? [picked] : []) as string[];
  answers["access"] = ACCESS_KINDS.filter((kind) => list.includes(kind));
  return { answers: answers as IntakeAnswers, cleared };
}

export function readIntake(input: Readonly<Record<string, string | readonly string[] | undefined>>): Result<IntakeAnswers, IntakeError | `too-long:${string}`> {
  const text = (name: keyof typeof LIMITS) => String(input[name] ?? "").trim().replace(/\r\n/g, "\n");
  const answers: Record<string, unknown> = {};
  for (const name of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const value = text(name);
    if (value.length > LIMITS[name]) return err(`too-long:${name}`);
    if (PASSWORD.test(value)) return err("looks-like-a-password");
    answers[name] = value;
  }
  if (!answers["businessName"]) return err("business-name-missing");
  const email = answers["email"] as string;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("invalid-email");
  const picked = input["access"];
  const list = (Array.isArray(picked) ? picked : picked ? [picked] : []) as string[];
  answers["access"] = ACCESS_KINDS.filter((kind) => list.includes(kind));
  return ok(answers as IntakeAnswers);
}

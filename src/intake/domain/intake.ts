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

export type IntakeError = "business-name-missing" | "too-long" | "looks-like-a-password" | "invalid-email";

/** Text that reads like a login: "password: ...", "pw=...", "pass - ...". */
const PASSWORD = /\b(pass(word|code)?|pwd|pw)\s*[:=\-]\s*\S/i;

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

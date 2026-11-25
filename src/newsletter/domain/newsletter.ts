// "Notes from the river", Potomac's newsletter (decision 0013, section 1).
// Who is on the list and from which river stop they signed up, what an issue
// is, and how an issue reads with its footer.
import type { Id } from "../../shared/domain/id.ts";
import { optionalText, requiredText } from "../../shared/domain/fields.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** The river stops of potomac.solutions, plus the site in general. A subscriber belongs to one. */
export const STOPS = ["mountains", "lakes", "roadside", "history", "enterprise", "general"] as const;
export type Stop = (typeof STOPS)[number];
export const STOP_LABELS: Readonly<Record<Stop, string>> = {
  mountains: "Mountains and farms",
  lakes: "Lakes and outdoors",
  roadside: "Roadside businesses",
  history: "History and the arts",
  enterprise: "Larger companies",
  general: "The site in general",
};
export const isStop = (value: string): value is Stop => (STOPS as readonly string[]).includes(value);

/**
 * The stop a sign-up came from, read from where the website says the person
 * was: `stop:lakes`, or just `lakes`. Anything else is the site in general.
 */
export function stopFrom(src: string): Stop {
  const text = src.trim().toLowerCase().replace(/^stop:/, "");
  return isStop(text) ? text : "general";
}

export const SUBSCRIBER_STATUSES = ["pending", "subscribed", "unsubscribed"] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

export type Subscriber = {
  readonly id: Id;
  /** Null once they unsubscribe: only the hash is kept, so they are never mailed again by mistake. */
  readonly email: string | null;
  readonly emailHash: string;
  readonly name: string | null;
  readonly stop: Stop;
  readonly status: SubscriberStatus;
  /** Where they signed up: the website, HQ's own page. */
  readonly source: "site" | "page";
  readonly confirmedAt: string | null;
  readonly unsubscribedAt: string | null;
  readonly createdAt: string;
};

export type SignUpError = "email-invalid" | "name-too-long";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An email someone typed, lower-cased, or null when it can't be one. */
export function cleanEmail(typed: string): string | null {
  const email = typed.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export function signUpFields(input: { readonly email: string; readonly name?: string | null }): Result<{ readonly email: string; readonly name: string | null }, SignUpError> {
  const email = cleanEmail(input.email);
  if (!email) return err("email-invalid");
  const name = optionalText((input.name ?? "").replace(/\s+/g, " "), 80);
  if (!name.ok) return err("name-too-long");
  return ok({ email, name: name.value });
}

/** How long a confirm link works. */
export const CONFIRM_DAYS = 7;

/** What a sign-up does to someone already on the list, or not on it. */
export function afterSignUp(existing: Subscriber | null): "new" | "resend" | "already" | "again" {
  if (!existing) return "new";
  if (existing.status === "subscribed") return "already";
  if (existing.status === "pending") return "resend";
  return "again";
}

export const ISSUE_STATUSES = ["draft", "sending", "sent"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export type Issue = {
  readonly id: Id;
  readonly subject: string;
  readonly body: string;
  /** The stops it goes to. Empty means everyone. */
  readonly stops: readonly Stop[];
  readonly status: IssueStatus;
  readonly createdBy: Id;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
};

export type IssueError = "subject-missing" | "subject-too-long" | "body-missing" | "body-too-long" | "invalid-stop";

export function issueFields(input: { readonly subject: string; readonly body: string; readonly stops: readonly string[] }): Result<{ readonly subject: string; readonly body: string; readonly stops: readonly Stop[] }, IssueError> {
  const subject = requiredText(input.subject.replace(/\s+/g, " "), 120);
  if (!subject.ok) return err(subject.error === "missing" ? "subject-missing" : "subject-too-long");
  const body = requiredText(input.body.replace(/\r\n/g, "\n"), 20_000);
  if (!body.ok) return err(body.error === "missing" ? "body-missing" : "body-too-long");
  const stops: Stop[] = [];
  for (const one of input.stops) {
    if (!isStop(one)) return err("invalid-stop");
    if (!stops.includes(one)) stops.push(one);
  }
  // Every stop chosen is the same as none chosen: everyone.
  return ok({ subject: subject.value, body: body.value, stops: stops.length === STOPS.length ? [] : STOPS.filter((one) => stops.includes(one)) });
}

/** Who an issue goes to, as a person reads it. */
export function audienceText(stops: readonly Stop[]): string {
  return stops.length === 0 ? "Everyone" : stops.map((one) => STOP_LABELS[one]).join(", ");
}

/** Whether a subscriber is in an issue's audience. */
export const inAudience = (stops: readonly Stop[], subscriber: { readonly stop: Stop }): boolean => stops.length === 0 || stops.includes(subscriber.stop);

/**
 * The email an issue becomes for one person: the issue, then why they get it,
 * how to leave, and Potomac's mailing address, which US anti-spam law asks
 * every newsletter to carry.
 */
export function issueEmail(issue: { readonly subject: string; readonly body: string }, footer: { readonly unsubscribeUrl: string; readonly address: string }): { readonly subject: string; readonly body: string } {
  const lines = [issue.body.trimEnd(), "", "—", "You’re getting Notes from the river because you signed up at potomac.solutions.", `Unsubscribe with one click: ${footer.unsubscribeUrl}`, `Potomac Solutions · ${footer.address}`];
  return { subject: issue.subject, body: lines.join("\n") };
}

/** How many sends go out a minute, so a long list never trips Brevo's limits. */
export const SENDS_PER_MINUTE = 50;

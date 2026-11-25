// Who looked at a demo (decision 0013, section 8). The Lab's demo apps, with
// the sign-in a prospect is given, and a short link of their own for each
// demo sent to a prospect, so Potomac knows who opened what.
import type { Id } from "../../shared/domain/id.ts";
import { optionalText, requiredText } from "../../shared/domain/fields.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type Demo = {
  readonly id: Id;
  readonly name: string;
  /** Where the demo lives, like https://counter.potomac.solutions */
  readonly url: string;
  /** What it is, in a line, for the email. */
  readonly description: string;
  /** The demo sign-in to give a prospect: it stays the same across the daily reset. */
  readonly signIn: string;
  readonly active: boolean;
};

export type DemoError = "name-missing" | "name-too-long" | "url-invalid" | "description-too-long" | "sign-in-too-long";

export function demoFields(input: { readonly name: string; readonly url: string; readonly description?: string | null; readonly signIn?: string | null }): Result<Pick<Demo, "name" | "url" | "description" | "signIn">, DemoError> {
  const name = requiredText(input.name.replace(/\s+/g, " "), 80);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const url = input.url.trim();
  if (url.length > 300 || !/^https:\/\/[^\s/@]+\.[^\s/@]+(\/[^\s]*)?$/.test(url)) return err("url-invalid");
  const description = optionalText((input.description ?? "").replace(/\s+/g, " "), 300);
  if (!description.ok) return err("description-too-long");
  const signIn = optionalText((input.signIn ?? "").replace(/\r\n/g, "\n"), 500);
  if (!signIn.ok) return err("sign-in-too-long");
  return ok({ name: name.value, url, description: description.value ?? "", signIn: signIn.value ?? "" });
}

/** A link's code: eight letters and digits that are hard to misread. */
export function linkCode(random: Uint8Array): string {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += letters[(random[i] ?? 0) % letters.length];
  return code;
}

export const isLinkCode = (typed: string): boolean => /^[a-z2-9]{8}$/.test(typed);

/** A program opening a link (a preview, a crawler) is not someone looking. */
export function isAutomated(userAgent: string): boolean {
  return userAgent.trim() === "" || /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|curl\/|wget\/|python-|headless|monitor|pingdom|uptime/i.test(userAgent);
}

/** The email that sends demos: each with its link and sign-in. */
export function demoEmail(input: { readonly firstName: string; readonly note: string; readonly demos: readonly { readonly name: string; readonly description: string; readonly link: string; readonly signIn: string }[] }): { readonly subject: string; readonly body: string } {
  const names = input.demos.map((one) => one.name);
  const subject = names.length === 1 ? `A demo to try: ${names[0]}` : `Demos to try: ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const blocks = input.demos.map((one) => [one.name + (one.description ? `: ${one.description}` : ""), one.link, ...(one.signIn ? [`Sign in with:\n${one.signIn}`] : [])].join("\n"));
  const body = [`Hi${input.firstName ? ` ${input.firstName}` : ""},`, "", ...(input.note ? [input.note, ""] : []), names.length === 1 ? "Here’s a demo to click around in. It’s a real app, with made-up data that resets every night, so try anything:" : "Here are some demos to click around in. They’re real apps, with made-up data that resets every night, so try anything:", "", blocks.join("\n\n"), "", "Questions, or want one like it for your business? Just reply.", "", "Mikey and Jayanti", "Potomac Solutions"].join("\n");
  return { subject, body };
}

/** How long "looked at a demo" stays on Today after the latest open, unless someone talks to them first. */
export const FOLLOW_UP_HOURS = 48;

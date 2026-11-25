// Saved replies (quality of life, 2026-11-25): a title and the text, with
// placeholders filled in where the reply is used.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type Reply = { readonly id: string; readonly title: string; readonly body: string };
export type ReplyError = "title-missing" | "title-too-long" | "body-missing" | "body-too-long";

export const PLACEHOLDERS = ["{first name}", "{client}", "{project}", "{me}"] as const;

export function readReply(input: { readonly title: string; readonly body: string }): Result<{ readonly title: string; readonly body: string }, ReplyError> {
  const title = input.title.replace(/\s+/g, " ").trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!title) return err("title-missing");
  if (title.length > 80) return err("title-too-long");
  if (!body) return err("body-missing");
  if (body.length > 5000) return err("body-too-long");
  return ok({ title, body });
}

/** The reply with what's known filled in; a placeholder with nothing to fill stays as written, to be filled by hand. */
export function fillReply(body: string, values: { readonly firstName?: string; readonly client?: string; readonly project?: string; readonly me?: string }): string {
  const known: Readonly<Record<string, string | undefined>> = { "{first name}": values.firstName, "{client}": values.client, "{project}": values.project, "{me}": values.me };
  return body.replace(/\{(first name|client|project|me)\}/gi, (match) => known[match.toLowerCase()] || match);
}

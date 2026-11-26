// What a text says, and reading a US mobile number (2026-11-26). Short, with
// who it's from, and how to stop.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const STOP_LINE = "Reply STOP to stop texts.";

/** A US number in any usual form, as +1 and ten digits. */
export function usPhone(raw: string): Result<string, "phone-invalid"> {
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  // Area codes and exchanges never start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return err("phone-invalid");
  return ok(`+1${digits}`);
}

/** As people write it: (304) 555-0142. */
export const showPhone = (e164: string) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");

export function callReminderText(input: { readonly when: string; readonly phone: string }): string {
  return [`Potomac Solutions: a reminder of your call ${input.when}.`, input.phone ? `To move it, call ${input.phone} or use your portal.` : "To move it, use your portal.", STOP_LINE].join(" ");
}

export function invoiceReminderText(input: { readonly label: string; readonly owed: string; readonly due: string; readonly overdue: boolean; readonly portalUrl: string }): string {
  const first = input.overdue ? `Potomac Solutions: ${input.label} for ${input.owed} was due ${input.due}.` : `Potomac Solutions: ${input.label} for ${input.owed} is due ${input.due}.`;
  return [first, `Pay or see it at ${input.portalUrl}`, STOP_LINE].join(" ");
}

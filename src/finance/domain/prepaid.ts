// Prepaid hours (decision 0017, third part): a client buys a block of hours
// up front; time logged on their projects from the first block on draws it
// down. HQ warns when what's left is low.
import { calendarDate, optionalText } from "../../shared/domain/fields.ts";
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type PrepaidBlock = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly minutes: number;
  readonly boughtOn: string;
  /** The invoice for it, when Potomac billed it from HQ. */
  readonly invoiceId: Id | null;
  readonly note: string;
  readonly createdBy: Id;
};

export type BlockInput = { readonly hours: string; readonly boughtOn: string; readonly note?: string | null };
export type BlockError = "invalid-hours" | "invalid-date" | "note-too-long";

/** Hours like "10" or "7.5", in quarter hours, up to 1,000. */
export function newBlock(ids: { readonly id: Id; readonly organizationId: Id; readonly createdBy: Id; readonly invoiceId: Id | null }, input: BlockInput): Result<PrepaidBlock, BlockError> {
  const text = input.hours.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return err("invalid-hours");
  const minutes = Math.round(Number(text) * 4) * 15;
  if (minutes <= 0 || minutes > 60_000) return err("invalid-hours");
  const on = calendarDate(input.boughtOn.trim());
  if (!on.ok) return err("invalid-date");
  const note = optionalText(input.note, 300);
  if (!note.ok) return err("note-too-long");
  return ok({ ...ids, minutes, boughtOn: on.value, note: note.value ?? "" });
}

/** Low: a fifth or less of what was bought is left, or two hours or less. */
export const LOW_SHARE = 0.2;
export const LOW_MINUTES = 120;

export type PrepaidBalance = { readonly boughtMinutes: number; readonly usedMinutes: number; readonly leftMinutes: number; readonly low: boolean; readonly since: string | null };

/** What's left: every block bought, less the time logged since the first one. */
export function prepaidBalance(blocks: readonly PrepaidBlock[], usedMinutes: number): PrepaidBalance {
  if (blocks.length === 0) return { boughtMinutes: 0, usedMinutes: 0, leftMinutes: 0, low: false, since: null };
  const bought = blocks.reduce((sum, one) => sum + one.minutes, 0);
  const left = bought - usedMinutes;
  return { boughtMinutes: bought, usedMinutes, leftMinutes: left, low: left <= LOW_MINUTES || left <= bought * LOW_SHARE, since: [...blocks].map((one) => one.boughtOn).sort()[0] ?? null };
}

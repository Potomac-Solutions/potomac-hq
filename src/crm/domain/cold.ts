// Going cold: an open opportunity nobody has been in touch about lately and
// that has no follow-up set. A follow-up on the calendar means someone has a
// plan, so it isn't cold, even if it's overdue (Today shows that as overdue).

/** Days without contact before an opportunity with no follow-up counts as going cold. */
export const COLD_AFTER_DAYS = 14;

/**
 * How many days it has been quiet, when it is going cold; null when it isn't.
 * `lastActive` is the day of the last touch with its client, or the last
 * change to the opportunity, whichever is later.
 */
export function quietDays(opportunity: { readonly followUpOn: string | null }, lastActive: string, today: string, after = COLD_AFTER_DAYS): number | null {
  if (opportunity.followUpOn !== null) return null;
  const days = Temporal.PlainDate.from(lastActive).until(Temporal.PlainDate.from(today), { largestUnit: "days" }).days;
  return days >= after ? days : null;
}

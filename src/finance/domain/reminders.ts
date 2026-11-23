// Reminders to a client about an invoice: a few days before it is due, the
// day after, a week late and two weeks late. Never more than one a day, and
// never one of a kind twice. Then it is a phone call, not another email.
export const REMINDER_KINDS = ["soon", "due", "late-7", "late-14"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];
export const REMINDER_LABELS: Readonly<Record<ReminderKind, string>> = { soon: "Coming due", due: "Due yesterday", "late-7": "A week late", "late-14": "Two weeks late" };

export type ReminderInvoice = { readonly status: string; readonly dueOn: string | null; readonly owedMinor: number };

/**
 * The reminder an invoice is due today, or null. Only the latest step that
 * has come counts: an invoice found two weeks late gets the two-week one,
 * not the three before it.
 */
export function reminderDue(invoice: ReminderInvoice, today: string, sent: readonly ReminderKind[]): ReminderKind | null {
  if (invoice.status !== "sent" || invoice.dueOn === null || invoice.owedMinor <= 0) return null;
  const late = Temporal.PlainDate.from(today).since(invoice.dueOn).days;
  const step: ReminderKind | null = late >= 14 ? "late-14" : late >= 7 ? "late-7" : late >= 1 ? "due" : late >= -3 && late < 0 ? "soon" : null;
  return step && !sent.includes(step) ? step : null;
}

export type ReminderEmailInput = {
  readonly kind: ReminderKind;
  readonly name: string;
  readonly businessName: string;
  readonly label: string;
  readonly owed: string;
  /** "Fri, Dec 4" */
  readonly due: string;
  readonly projectName: string;
  /** Where to see the invoice: the portal, if they have it. */
  readonly portalUrl: string | null;
  readonly phone: string;
  readonly address: string;
};

export function reminderEmail(input: ReminderEmailInput): { readonly subject: string; readonly body: string } {
  const first = input.name.split(" ")[0] ?? input.name;
  const subject = {
    soon: `${input.label} is due ${input.due}`,
    due: `${input.label} was due ${input.due}`,
    "late-7": `${input.label} is a week overdue`,
    "late-14": `${input.label} is two weeks overdue`,
  }[input.kind];
  const opening = {
    soon: `A reminder that invoice ${input.label} for ${input.projectName}, ${input.owed}, is due ${input.due}.`,
    due: `Invoice ${input.label} for ${input.projectName}, ${input.owed}, was due ${input.due}. If it's already on its way, thank you, and please ignore this.`,
    "late-7": `Invoice ${input.label} for ${input.projectName} is a week past due, with ${input.owed} still owed. If something's wrong with it, or the timing is hard, tell us and we'll work it out.`,
    "late-14": `Invoice ${input.label} for ${input.projectName} is two weeks past due, with ${input.owed} still owed. Please call us so we can sort it out together.`,
  }[input.kind];
  const lines = [`Hi ${first},`, "", opening, "", `How to pay: a check made out to Potomac Solutions, or cash. Write ${input.label} on the check.`];
  if (input.address) lines.push(`Mail it to: ${input.address}`);
  if (input.portalUrl) lines.push("", `See the invoice and download it: ${input.portalUrl}`);
  if (input.phone) lines.push("", `Questions? Call ${input.phone}.`);
  lines.push("", "Thank you,", "Potomac Solutions");
  return { subject, body: lines.join("\n") };
}

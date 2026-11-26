// Receipts and monthly statements emailed to a client (decision 0017, third
// part), in the same plain voice as invoice reminders. Sent only when
// Potomac has turned invoice emails on, and once each.

/** How to pay, in Potomac's words when it has set them, otherwise checks and cash. */
export function howToPay(input: { readonly instructions: string; readonly label?: string; readonly address: string }): string[] {
  if (input.instructions.trim()) return ["How to pay:", input.instructions.trim()];
  const lines = [`How to pay: a check made out to Potomac Solutions, or cash.${input.label ? ` Write ${input.label} on the check.` : ""}`];
  if (input.address) lines.push(`Mail it to: ${input.address}`);
  return lines;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

export type ReceiptInput = {
  readonly name: string;
  readonly businessName: string;
  readonly label: string;
  readonly amount: string;
  /** "Wed, Nov 25" */
  readonly on: string;
  readonly method: string;
  /** "" when paid in full. */
  readonly stillOwed: string;
  readonly portalUrl: string | null;
  readonly phone: string;
};

/** A receipt for money received against an invoice. */
export function receiptEmail(input: ReceiptInput): { readonly subject: string; readonly body: string } {
  const lines = [`Hi ${firstName(input.name)},`, "", `Thank you: we received ${input.amount} for invoice ${input.label} on ${input.on}, by ${input.method.toLowerCase()}.`];
  lines.push("", input.stillOwed ? `${input.stillOwed} is still owed on it.` : `${input.label} is paid in full.`);
  if (input.portalUrl) lines.push("", `Your invoices and payments: ${input.portalUrl}`);
  if (input.phone) lines.push("", `Questions? Call ${input.phone}.`);
  lines.push("", "Thank you,", "Potomac Solutions");
  return { subject: `Receipt for ${input.label}: ${input.amount}`, body: lines.join("\n") };
}

export type StatementInput = {
  readonly name: string;
  readonly businessName: string;
  /** "December 2026" */
  readonly month: string;
  readonly invoices: readonly { readonly label: string; readonly forWhat: string; readonly owed: string; readonly due: string; readonly overdue: boolean }[];
  readonly total: string;
  readonly instructions: string;
  readonly address: string;
  readonly portalUrl: string | null;
  readonly phone: string;
};

/** Everything a client still owes, in one email at the start of a month. */
export function statementEmail(input: StatementInput): { readonly subject: string; readonly body: string } {
  const lines = [`Hi ${firstName(input.name)},`, "", `Here's where ${input.businessName}'s account stands for ${input.month}: ${input.total} owed in all.`, ""];
  for (const one of input.invoices) lines.push(`- ${one.label}${one.forWhat ? `, ${one.forWhat}` : ""}: ${one.owed}${one.due ? `, ${one.overdue ? "was due" : "due"} ${one.due}` : ""}`);
  lines.push("", ...howToPay({ instructions: input.instructions, address: input.address }));
  if (input.portalUrl) lines.push("", `See each invoice and download it: ${input.portalUrl}`);
  if (input.phone) lines.push("", `Questions, or something looks wrong? Call ${input.phone}.`);
  lines.push("", "Thank you,", "Potomac Solutions");
  return { subject: `Your statement for ${input.month}: ${input.total} owed`, body: lines.join("\n") };
}

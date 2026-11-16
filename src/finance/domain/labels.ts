// Words for people. Codes stay in storage; these are what screens show.
export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  software: "Software",
  hosting: "Hosting",
  domain: "Domain",
  contractor: "Contractor",
  hardware: "Hardware",
  travel: "Travel",
  supplies: "Supplies",
  other: "Other",
};

export const PAYMENT_LABELS: Readonly<Record<string, string>> = {
  "not-invoiced": "Not invoiced",
  "deposit-paid": "Deposit paid",
  invoiced: "Invoiced",
  paid: "Paid in full",
};

export const INVOICE_STATUS_LABELS: Readonly<Record<string, string>> = { draft: "Draft", sent: "Sent, waiting for payment", paid: "Paid", void: "Void" };
export const INVOICE_KIND_LABELS: Readonly<Record<string, string>> = { deposit: "Deposit", balance: "Balance", full: "Full amount", other: "Something else" };
export const METHOD_LABELS: Readonly<Record<string, string>> = { cash: "Cash", check: "Check", card: "Card, through a gateway", transfer: "Bank transfer", other: "Other" };

/** [{ value, label }] for a select. */
export function options(labels: Readonly<Record<string, string>>): { value: string; label: string }[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

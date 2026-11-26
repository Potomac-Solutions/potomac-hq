// The year-end tax pack (2026-11-26): one download for whoever does the
// taxes. Cash basis, like profit and loss: money in on the day it came,
// refunds as money back out, expenses with their receipts. Not the books of
// record (that's the finance sheet) and not tax advice.
import { CATEGORY_LABELS, METHOD_LABELS } from "../domain/labels.ts";
import { invoiceLabel } from "../domain/invoice.ts";
import { authorize } from "../../identity/index.ts";
import { err, formatMoney, ok, recordActivity, toCsv, zipFiles, type Id, type Result } from "../../shared/index.ts";
import type { FinanceDeps } from "./commands.ts";

const dollars = (minor: number) => Number((minor / 100).toFixed(2));
const usd = (minor: number) => formatMoney({ minor, currency: "USD" });
const safeName = (name: string) => name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "receipt";

export function taxPackYears(deps: FinanceDeps): readonly number[] {
  const thisYear = Number(deps.today().slice(0, 4));
  const first = Math.min(thisYear, ...deps.invoices.allPayments().map((one) => Number(one.receivedOn.slice(0, 4))));
  return Array.from({ length: Math.min(10, thisYear - first + 1) }, (_, n) => thisYear - n);
}

export function taxPack(deps: FinanceDeps, actorId: Id | null, year: number): Result<{ readonly fileName: string; readonly bytes: Uint8Array<ArrayBuffer> }, "forbidden" | "not-found"> {
  if (actorId === null || !authorize(deps, actorId, "finance.export").ok) return err("forbidden");
  if (!taxPackYears(deps).includes(year)) return err("not-found");
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const inYear = (on: string | null) => on !== null && on >= from && on <= to;
  const today = deps.today();
  const invoices = deps.invoices.list();
  const byInvoice = new Map(invoices.map((one) => [one.id as string, one]));

  const income = deps.invoices.allPayments().filter((one) => inYear(one.receivedOn));
  const incomeRows = income.map((one) => [one.receivedOn, invoiceLabel(one.number), one.clientName, one.projectName, METHOD_LABELS[one.method] ?? one.method, dollars(one.amount.minor), one.amount.minor < 0 ? "refund" : "payment", one.reference]);
  const byClient = new Map<string, number>();
  for (const one of income) byClient.set(one.clientName, (byClient.get(one.clientName) ?? 0) + one.amount.minor);

  const expenses = deps.expenses.list({ from, to });
  const files: Record<string, string | Uint8Array> = {};
  const expenseRows = expenses.map((one) => {
    let receipt = "";
    if (one.receiptFileId) {
      const bytes = deps.blobs.get(one.receiptFileId);
      if (bytes) {
        receipt = `receipts/${one.spentOn}-${safeName(one.receiptName ?? "receipt")}`;
        let n = 2;
        while (files[receipt]) receipt = receipt.replace(/(\.[^.]+)?$/, (ext) => `-${n++}${ext}`);
        files[receipt] = bytes;
      }
    }
    return [one.spentOn, CATEGORY_LABELS[one.category] ?? one.category, dollars(one.amount.minor), one.clientName, one.projectName, one.note, receipt];
  });
  const byCategory = new Map<string, number>();
  for (const one of expenses) byCategory.set(CATEGORY_LABELS[one.category] ?? one.category, (byCategory.get(CATEGORY_LABELS[one.category] ?? one.category) ?? 0) + one.amount.minor);

  // Owed at the year's end: sent in the year or before, not paid then. For an accountant working on accruals.
  const paidBy = new Map<string, number>();
  for (const one of deps.invoices.allPayments()) if (one.receivedOn <= to) paidBy.set(one.invoiceId, (paidBy.get(one.invoiceId) ?? 0) + one.amount.minor);
  const owed = invoices
    .filter((one) => one.issuedOn !== null && one.issuedOn <= to && (one.status === "sent" || one.status === "paid" || (one.status === "void" && (one.writtenOffOn ?? "9999") > to)))
    .map((one) => ({ one, left: one.total.minor - (paidBy.get(one.id) ?? 0) }))
    .filter((row) => row.left > 0)
    .map(({ one, left }) => [invoiceLabel(one.number), one.clientName, one.issuedOn ?? "", one.dueOn ?? "", dollars(one.total.minor), dollars(left)]);

  const written = invoices.filter((one) => one.writtenOffOn !== null && inYear(one.writtenOffOn)).map((one) => [invoiceLabel(one.number), one.clientName, one.writtenOffOn ?? "", dollars(one.total.minor - (paidBy.get(one.id) ?? 0)), one.writtenOffNote]);

  const received = income.filter((one) => one.amount.minor > 0).reduce((sum, one) => sum + one.amount.minor, 0);
  const refunded = -income.filter((one) => one.amount.minor < 0).reduce((sum, one) => sum + one.amount.minor, 0);
  const spent = expenses.reduce((sum, one) => sum + one.amount.minor, 0);
  const lines = [
    `Potomac Solutions, ${year}`,
    `Made by Potomac HQ on ${today}${year === Number(today.slice(0, 4)) ? ", before the year was over: it is so far" : ""}.`,
    "",
    "Cash basis: money counted on the day it came in or went out.",
    "",
    `Money in:            ${usd(received)}`,
    `Refunds given back:  ${usd(refunded)}`,
    `Expenses:            ${usd(spent)}`,
    `Left:                ${usd(received - refunded - spent)}`,
    "",
    "Expenses by category:",
    ...[...byCategory].toSorted((a, b) => b[1] - a[1]).map(([name, minor]) => `  ${name}: ${usd(minor)}`),
    "",
    "What's in this folder:",
    "  income.csv               every payment received, and every refund as a negative amount",
    "  income-by-client.csv     the same, added up by client (for 1099s you may receive)",
    "  expenses.csv             every expense, with its receipt's file name when there is one",
    "  expenses-by-category.csv the same, added up by category",
    "  owed-at-year-end.csv     invoices sent but not paid by December 31",
    "  written-off.csv          invoices written off this year, with why",
    "  receipts/                the receipts themselves",
    "",
    "Not in here: card processing fees. PayPal, Stripe or Square keep those;",
    "download the year's statement from the platform. Nor is anything you paid",
    "outside HQ, such as your phone bill or mileage, unless it was entered.",
    "",
    "This is a summary to hand to whoever does your taxes, not tax advice.",
  ];
  Object.assign(files, {
    "README.txt": lines.join("\n") + "\n",
    "income.csv": toCsv(["Date", "Invoice", "Client", "Project", "How", "Amount", "Kind", "Reference"], incomeRows),
    "income-by-client.csv": toCsv(["Client", "Received"], [...byClient].toSorted((a, b) => b[1] - a[1]).map(([name, minor]) => [name, dollars(minor)])),
    "expenses.csv": toCsv(["Date", "Category", "Amount", "Client", "Project", "Note", "Receipt"], expenseRows),
    "expenses-by-category.csv": toCsv(["Category", "Spent"], [...byCategory].toSorted((a, b) => b[1] - a[1]).map(([name, minor]) => [name, dollars(minor)])),
    "owed-at-year-end.csv": toCsv(["Invoice", "Client", "Sent", "Due", "Total", "Still owed"], owed),
    "written-off.csv": toCsv(["Invoice", "Client", "Written off", "Amount", "Why"], written),
  });
  deps.transact(() => recordActivity(deps, { actorId, action: "finance.tax-pack", recordType: "export", recordId: deps.newId(), context: { year, payments: income.length, expenses: expenses.length } }));
  const folder = `potomac-taxes-${year}`;
  return ok({ fileName: `${folder}.zip`, bytes: zipFiles(files, folder, new Date(deps.clock())) });
}

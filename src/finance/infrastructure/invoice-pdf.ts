// An invoice as a PDF, for sending to the client.
import type { InvoiceDocument } from "../application/queries.ts";
import { pdfDocument } from "../../shared/adapters.ts";

export function renderInvoicePdf(invoice: InvoiceDocument): Uint8Array<ArrayBuffer> {
  const doc = pdfDocument({ title: `Invoice ${invoice.label}`, footer: `Potomac Solutions · Invoice ${invoice.label}` });
  doc.paragraph("Potomac Solutions", { bold: true });
  doc.heading(`Invoice ${invoice.label}`, 1);
  doc.paragraph(`Billed to ${invoice.clientName}`, { muted: true });
  if (invoice.projectName) doc.paragraph(`For ${invoice.projectName}`, { muted: true });
  doc.paragraph(`Issued ${invoice.issuedOn}${invoice.dueOn ? `. Due ${invoice.dueOn}` : ""}`, { muted: true });
  doc.space();
  const rows = invoice.lines.map((line) => [line.description, line.amount]);
  const totals = [["Total", invoice.total], ...(invoice.paid ? [["Received", invoice.paid], ["Amount due", invoice.owed]] : [])];
  doc.table([{ width: 5 }, { width: 2, align: "right" }], [["Description", "Amount"], ...rows, ...totals], { header: true, boldLastRow: true });
  if (invoice.note) doc.paragraph(invoice.note);
  doc.paragraph("Payment by cash or check to Potomac Solutions. Thank you.");
  return doc.finish();
}

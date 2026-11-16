// A sent proposal as a PDF, for sending to the client (roadmap v0.4).
import type { ProposalDocument } from "../application/queries.ts";
import { pdfDocument } from "../../shared/adapters.ts";

export function renderProposalPdf(proposal: ProposalDocument): Uint8Array<ArrayBuffer> {
  const doc = pdfDocument({ title: `Proposal: ${proposal.title}`, footer: `Potomac Solutions · ${proposal.title} · Version ${proposal.number}` });
  doc.paragraph("Potomac Solutions", { bold: true });
  doc.heading(proposal.title, 1);
  const forWhom = [proposal.clientName, proposal.contactName].filter((part) => part !== "").join(" · ");
  if (forWhom) doc.paragraph(`Prepared for ${forWhom}`, { muted: true });
  doc.paragraph(`Version ${proposal.number}, sent ${proposal.sentWhen}${proposal.sentBy ? ` by ${proposal.sentBy}` : ""}`, { muted: true });

  for (const section of proposal.sections) {
    doc.heading(section.heading);
    for (const block of section.blocks) {
      if (block.bullet) doc.bullet(block.text);
      else doc.paragraph(block.text);
    }
  }

  doc.heading("Estimate");
  const rows = proposal.lines.map((line) => [line.item, line.quantityLabel, line.rate, line.total]);
  const total = ["Total", proposal.summary.hours ? `${proposal.summary.hours} h` : "", "", proposal.summary.price];
  doc.table([{ width: 5 }, { width: 2, align: "right" }, { width: 2, align: "right" }, { width: 3, align: "right" }], [["Item", "Hours or quantity", "Rate", "Total"], ...rows, total], { header: true, boldLastRow: true });
  doc.paragraph(`Pricing: ${proposal.summary.pricingLabel}.`);
  if (proposal.summary.deposit) doc.paragraph(`A deposit of ${proposal.summary.deposit}, one third of the total, is due before work starts. The balance of ${proposal.summary.balance} is due before launch.`);

  doc.heading("Acceptance");
  doc.paragraph("To accept this proposal, sign below or reply in writing. Work is scheduled once it is accepted.");
  doc.space(26);
  doc.table([{ width: 3 }, { width: 2 }], [["Name and signature", "Date"]], {});
  return doc.finish();
}

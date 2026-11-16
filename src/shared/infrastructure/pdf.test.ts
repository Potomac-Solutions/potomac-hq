import assert from "node:assert/strict";
import { test } from "node:test";
import { pdfDocument } from "./pdf.ts";

const read = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

function sample(paragraphs = 3): string {
  const doc = pdfDocument({ title: "Proposal: Bakery app", footer: "Potomac Solutions" });
  doc.heading("Bakery app", 1);
  doc.heading("Scope");
  for (let i = 0; i < paragraphs; i += 1) doc.paragraph(`Paragraph ${i}: orders, pickup times and a kitchen screen that lists what is due.`);
  doc.bullet("Order ahead");
  doc.table([{ width: 3 }, { width: 1, align: "right" }], [["Item", "Total"], ["Design", "$600.00"], ["Total", "$600.00"]], { header: true, boldLastRow: true });
  return read(doc.finish());
}

test("the file has a header, a trailer, and a cross-reference table whose offsets are exact", () => {
  const pdf = sample();
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.ok(pdf.endsWith("%%EOF\n"));
  const start = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)?.[1]);
  assert.equal(pdf.slice(start, start + 5), "xref\n");
  const offsets = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  assert.ok(offsets.length >= 6);
  offsets.forEach((offset, index) => assert.equal(pdf.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`, `object ${index + 1}`));
  assert.match(pdf, new RegExp(`/Size ${offsets.length + 1} `));
});

test("every content stream says its true length", () => {
  const pdf = sample();
  for (const match of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal((match[2] as string).length, Number(match[1]));
});

test("long content flows onto more pages, each with its number", () => {
  assert.match(sample(), /\/Count 1 /);
  const long = sample(120);
  const pages = Number(/\/Count (\d+) /.exec(long)?.[1]);
  assert.ok(pages >= 3, `${pages} pages`);
  const hex = (text: string) => [...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  assert.ok(long.includes(hex(`Page ${pages} of ${pages}`)));
});

test("text is written as hex, so nothing in it can break out of a string", () => {
  const doc = pdfDocument({ title: "x" });
  doc.paragraph("Quote ) and ( and \\ and “curly” — dash • bullet ’s 日本");
  const pdf = read(doc.finish());
  assert.ok(!pdf.includes("Quote )"));
  // ) ( \ as bytes, curly quotes and the dash in Windows-1252, and "?" for what it lacks.
  assert.ok(pdf.includes("2920616e64202820616e64205c"));
  assert.ok(pdf.includes("93"));
  assert.ok(pdf.includes("3f3f"));
});

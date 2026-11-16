// A small PDF writer: headings, paragraphs, bullets and tables on US Letter
// pages, in the two standard Helvetica faces every PDF reader has built in.
// No package and no font files. It exists so a proposal can be sent as a PDF
// (roadmap v0.4) without adding a rendering engine to the server.
//
// Text is laid out with Helvetica's published character widths, so wrapping
// and right-aligned numbers line up. Characters outside Windows-1252 are
// written as "?".

const PAGE = { width: 612, height: 792, margin: 64 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

// Helvetica advance widths for characters 32 to 126, in thousandths of the font size.
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778,
  722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// Bold is a little wider. Digits are the same width in both faces.
const BOLD_FACTOR = 1.07;

// Characters Windows-1252 has above 127 that people actually type.
const CP1252: Readonly<Record<string, number>> = { "€": 0x80, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "…": 0x85, "™": 0x99 };

function encode(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (code >= 32 && code <= 126) bytes.push(code);
    else if (code >= 160 && code <= 255) bytes.push(code);
    else bytes.push(CP1252[char] ?? (char === "\t" ? 32 : 63));
  }
  return bytes;
}

function widthOf(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const byte of encode(text)) units += byte >= 32 && byte <= 126 ? (WIDTHS[byte - 32] ?? 556) : 556;
  return (units / 1000) * size * (bold && !/^[\d$.,\s-]*$/.test(text) ? BOLD_FACTOR : 1);
}

function wrap(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((part) => part !== "")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (widthOf(candidate, size, bold) <= maxWidth || line === "") line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

const hex = (text: string): string => `<${encode(text).map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
const num = (value: number): string => String(Math.round(value * 100) / 100);

export type Column = { readonly width: number; readonly align?: "left" | "right" };

export type PdfDocument = {
  heading(text: string, level?: 1 | 2): void;
  paragraph(text: string, options?: { muted?: boolean; bold?: boolean }): void;
  bullet(text: string): void;
  /** `columns` widths are shares of the page width and need not add up to anything in particular. */
  table(columns: readonly Column[], rows: readonly (readonly string[])[], options?: { header?: boolean; boldLastRow?: boolean }): void;
  space(points?: number): void;
  /** The finished file. */
  finish(): Uint8Array<ArrayBuffer>;
};

export function pdfDocument(meta: { readonly title: string; readonly author?: string; readonly footer?: string }): PdfDocument {
  const pages: string[][] = [[]];
  let y = PAGE.height - PAGE.margin;
  const page = () => pages[pages.length - 1] as string[];

  function room(height: number): void {
    if (y - height >= PAGE.margin) return;
    pages.push([]);
    y = PAGE.height - PAGE.margin;
  }
  function draw(text: string, x: number, size: number, bold: boolean, grey = 0): void {
    page().push(`BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${num(grey)} g ${num(x)} ${num(y)} Td ${hex(text)} Tj ET`);
  }
  function block(text: string, size: number, bold: boolean, options: { indent?: number; lead?: number; grey?: number; prefix?: string } = {}): void {
    const indent = options.indent ?? 0;
    const lead = options.lead ?? size * 1.4;
    const lines = wrap(text, size, bold, CONTENT_WIDTH - indent);
    lines.forEach((line, index) => {
      room(lead);
      y -= lead;
      if (index === 0 && options.prefix) draw(options.prefix, PAGE.margin + indent - 12, size, false, options.grey ?? 0);
      draw(line, PAGE.margin + indent, size, bold, options.grey ?? 0);
    });
  }
  function rule(grey: number): void {
    page().push(`${num(grey)} G 0.5 w ${num(PAGE.margin)} ${num(y)} m ${num(PAGE.width - PAGE.margin)} ${num(y)} l S`);
  }

  return {
    heading(text, level = 2) {
      const size = level === 1 ? 20 : 13;
      room(size * 3);
      y -= level === 1 ? 4 : 12;
      block(text, size, true);
      y -= level === 1 ? 6 : 2;
    },
    paragraph(text, options = {}) {
      block(text, 10.5, options.bold === true, { grey: options.muted ? 0.4 : 0 });
      y -= 4;
    },
    bullet(text) {
      block(text, 10.5, false, { indent: 16, prefix: "•" });
      y -= 2;
    },
    table(columns, rows, options = {}) {
      const size = 10;
      const pad = 6;
      const share = columns.reduce((sum, column) => sum + column.width, 0);
      const widths = columns.map((column) => (column.width / share) * CONTENT_WIDTH);
      rows.forEach((row, rowIndex) => {
        const bold = (options.header === true && rowIndex === 0) || (options.boldLastRow === true && rowIndex === rows.length - 1);
        const cells = columns.map((_, i) => wrap(row[i] ?? "", size, bold, (widths[i] ?? 0) - pad * 2));
        const height = Math.max(1, ...cells.map((lines) => lines.length)) * size * 1.35 + pad;
        room(height + 2);
        const top = y;
        let x = PAGE.margin;
        cells.forEach((lines, i) => {
          const width = widths[i] ?? 0;
          lines.forEach((line, lineIndex) => {
            y = top - pad / 2 - size * 1.35 * (lineIndex + 1) + 3;
            const left = columns[i]?.align === "right" ? x + width - pad - widthOf(line, size, bold) : x + pad;
            draw(line, left, size, bold);
          });
          x += width;
        });
        y = top - height;
        rule(options.header === true && rowIndex === 0 ? 0.3 : 0.8);
      });
      y -= 8;
    },
    space(points = 10) {
      y -= points;
    },
    finish() {
      const objects: string[] = [];
      const add = (body: string): number => objects.push(body);
      const catalog = add("");
      const tree = add("");
      const regular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      const kids: number[] = [];
      pages.forEach((commands, index) => {
        const footer = `${meta.footer ? `${meta.footer}   ` : ""}Page ${index + 1} of ${pages.length}`;
        const stream = [...commands, `BT /F1 8 Tf 0.4 g ${num(PAGE.margin)} ${num(PAGE.margin - 28)} Td ${hex(footer)} Tj ET`].join("\n");
        const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
      });
      objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
      objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`;
      const info = add(`<< /Title ${hex(meta.title)} /Author ${hex(meta.author ?? "Potomac Solutions")} /Producer ${hex("Potomac HQ")} >>`);

      // Every byte written is ASCII, so a string's length is its byte length
      // and the offsets in the cross-reference table are exact.
      let out = "%PDF-1.4\n";
      const offsets: number[] = [];
      objects.forEach((body, index) => {
        offsets.push(out.length);
        out += `${index + 1} 0 obj\n${body}\nendobj\n`;
      });
      const xref = out.length;
      out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
      out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i);
      return bytes;
    },
  };
}

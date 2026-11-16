// An article's body is written in a small part of Markdown: headings, lists,
// tables, code and paragraphs. This turns it into blocks a page can show
// with ordinary elements. No HTML in a body is ever passed through: a page
// prints each block's text as text.
export type Block =
  | { readonly type: "heading"; readonly level: 2 | 3 | 4; readonly text: string }
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: "code"; readonly text: string }
  | { readonly type: "table"; readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] };

/** Emphasis marks are dropped, and a link becomes its text and address. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_all, label: string, href: string) => (label === href ? label : `${label} (${href})`))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => plain(cell));
const isRule = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const LIST = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/;

export function toBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] as string)) code.push(lines[i++] as string);
      i++;
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // The page's own <h1> is the title, so a body's headings start at <h2>.
      const level = Math.min(4, Math.max(2, (heading[1] as string).length)) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, text: plain(heading[2] as string) });
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isRule(lines[i + 1] as string)) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] as string).includes("|") && (lines[i] as string).trim() !== "") {
        const row = cells(lines[i++] as string);
        rows.push(header.map((_h, n) => row[n] ?? ""));
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const first = LIST.exec(line);
    if (first) {
      const ordered = first[2] !== undefined;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] as string;
        const item = LIST.exec(current);
        if (item && (item[2] !== undefined) === ordered) items.push(item[3] as string);
        // A line indented under an item continues it.
        else if (items.length > 0 && /^\s{2,}\S/.test(current)) items[items.length - 1] += ` ${current.trim()}`;
        else break;
        i++;
      }
      blocks.push({ type: "list", ordered, items: items.map(plain) });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] as string).trim() !== "" && !/^\s*```/.test(lines[i] as string) && !/^#{1,6}\s/.test(lines[i] as string) && !LIST.test(lines[i] as string) && !((lines[i] as string).includes("|") && i + 1 < lines.length && isRule(lines[i + 1] as string))) {
      paragraph.push((lines[i++] as string).trim().replace(/^>\s?/, ""));
    }
    blocks.push({ type: "paragraph", text: plain(paragraph.join(" ")) });
  }
  return blocks;
}

/** A document's first heading and the rest of it. For HQ's own documents. */
export function splitTitle(markdown: string): { title: string; body: string } {
  const text = markdown.replace(/\r\n?/g, "\n");
  const match = /^\s*#\s+(.+)\n?/.exec(text);
  return match ? { title: plain(match[1] as string), body: text.slice(match[0].length).trim() } : { title: "", body: text.trim() };
}

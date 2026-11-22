// Search from the top bar: what was typed, made into words to look for.
// Nothing typed is ever put into SQL: the words are passed as values.

export const MAX_QUERY = 100;
/** The most of one kind of record shown. */
export const PER_KIND = 8;

export type SearchWords = { readonly text: string; readonly words: readonly string[]; readonly invoiceNumber: number | null };

/**
 * "  Mt. Storm   bakery " → words ["mt.", "storm", "bakery"]. A word of one
 * letter is dropped unless it is the only one. "INV-0003", "inv 3" and "#3"
 * also name invoice 3.
 */
export function searchWords(raw: string): SearchWords {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  const all = text.toLowerCase().split(" ").filter((word) => word.length > 0);
  const longer = all.filter((word) => word.length > 1);
  const words = longer.length > 0 ? longer : all;
  const invoice = /^(?:inv(?:oice)?[\s-]*|#)0*(\d{1,6})$/i.exec(text);
  return { text, words: words.slice(0, 6), invoiceNumber: invoice ? Number(invoice[1]) : null };
}

/** Ranks a match: the name starting with what was typed first, then a word starting with it, then anywhere. */
export function rank(name: string, words: readonly string[]): number {
  const lower = name.toLowerCase();
  const first = words[0] ?? "";
  if (lower.startsWith(words.join(" "))) return 0;
  if (lower.split(/[\s\-–—.,/&()]+/).some((part) => part.startsWith(first))) return 1;
  return 2;
}

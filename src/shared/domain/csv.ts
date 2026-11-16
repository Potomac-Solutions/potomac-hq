// CSV as spreadsheets read it (RFC 4180): fields quoted when they need it,
// rows ended with CRLF, and a byte order mark so Excel reads it as UTF-8.
export type Cell = string | number | null;

/**
 * One field. Text that a spreadsheet would run as a formula (it starts with
 * =, +, - or @) is given a leading apostrophe, so an exported note can never
 * do anything when the file is opened. Numbers are written as they are, so
 * pass an amount as a number (cents divided by 100), never as text.
 */
export function csvField(value: Cell): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

// Task keys (decision 0008, section 1). Each project has a short key, made
// from its name ("Better Days website" is BDW), and its tasks are numbered
// from 1, so a task is BDW-12. To-dos are TODO-7. A key already taken gets a
// digit. Changing a project's key keeps the old one finding its tasks.
//
// The migration that brought keys in made them for existing projects by the
// same rule, in SQL (migrations/0052-task-keys.sql).

/** The key to-dos are written with. Never a project's. */
export const TODO_KEY = "TODO";
/** Keys no project may have: TODO is the to-dos', and INV-0003 is an invoice number. */
const RESERVED: ReadonlySet<string> = new Set([TODO_KEY, "INV"]);

const KEY = /^[A-Z][A-Z0-9]{1,5}$/;

/** Initials of up to five words, or the first three letters of a single one. */
export function keyFromName(name: string, taken: ReadonlySet<string>): string {
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const first = words[0] ?? "";
  let base = words.length > 1 ? words.slice(0, 5).map((word) => word[0]).join("") : first.slice(0, 3);
  // A name in other scripts has no letters to use, as the migration found too.
  if (base === "") base = "PRJ";
  if (!/^[A-Z]/.test(base)) base = `P${base}`;
  if (base.length < 2) base = `${base}X`.slice(0, 2).padEnd(2, "X");
  const free = (key: string) => !RESERVED.has(key) && !taken.has(key);
  if (free(base)) return base;
  for (let n = 2; ; n += 1) {
    const key = `${base.slice(0, 6 - String(n).length)}${n}`;
    if (free(key)) return key;
  }
}

export type KeyError = "invalid-key" | "key-taken";

/** A key someone typed: 2 to 6 letters or digits, starting with a letter, written in capitals. */
export function readKey(text: string): { ok: true; value: string } | { ok: false; error: "invalid-key" } {
  const key = text.trim().toUpperCase();
  return KEY.test(key) && !RESERVED.has(key) ? { ok: true, value: key } : { ok: false, error: "invalid-key" };
}

/** "BDW-12". */
export const taskRef = (key: string | null, number: number | null): string => (key && number ? `${key}-${number}` : "");

/** A task's key and number from text like "bdw-12" or "BDW-12", or null. */
export function readRef(text: string): { readonly key: string; readonly number: number } | null {
  const match = /^\s*([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,7})\s*$/.exec(text);
  return match ? { key: (match[1] as string).toUpperCase(), number: Number(match[2]) } : null;
}

/** Every task key written in some text, like a commit message: "BDW-12", in capitals, as GitHub users write them. */
export function refsIn(text: string): { readonly key: string; readonly number: number }[] {
  const found: { key: string; number: number }[] = [];
  for (const match of text.matchAll(/(?<![A-Za-z0-9-])([A-Z][A-Z0-9]{1,5})-(\d{1,7})(?![0-9])/g)) {
    const ref = { key: match[1] as string, number: Number(match[2]) };
    if (!found.some((one) => one.key === ref.key && one.number === ref.number)) found.push(ref);
  }
  return found;
}

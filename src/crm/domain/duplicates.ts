// Duplicate warnings (quality of life, 2026-11-25): whether a new client's
// name looks like one already in HQ. "Better Days Towing LLC", "better days
// towing" and "Better Days Towing, Inc." are the same business.

const NOISE = new Set(["llc", "inc", "co", "company", "corp", "corporation", "ltd", "the", "and", "of"]);

/** A name as words to compare: lower case, no punctuation, no "LLC" or "the". */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !NOISE.has(word))
    .join(" ");
}

/** How many single-letter changes turn one into the other. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const kept = row[j] as number;
      row[j] = Math.min((row[j] as number) + 1, (row[j - 1] as number) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length] as number;
}

/** Whether two business names are probably the same business. */
export function sameBusiness(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = shorter === x ? y : x;
  // "Better Days" against "Better Days Towing": one is the other with a word more.
  if (shorter.length >= 6 && (` ${longer} `.includes(` ${shorter} `))) return true;
  // A typo or two in a longer name.
  return shorter.length >= 8 && distance(x, y) <= (shorter.length >= 16 ? 2 : 1);
}

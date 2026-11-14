// Shared helpers for reading CHANGELOG.md.
import { readFileSync } from "node:fs";

export const CHANGELOG = "CHANGELOG.md";

export function readChangelog() {
  return readFileSync(CHANGELOG, "utf8");
}

/** The body under a "## [name]" heading, trimmed, or null if the heading is missing. */
export function section(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## [${name}]`));
  if (start === -1) return null;
  let end = lines.findIndex((line, i) => i > start && line.startsWith("## ["));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

/** True when a section has at least one list item. */
export function hasEntries(body) {
  return body !== null && /^\s*[-*] /m.test(body);
}

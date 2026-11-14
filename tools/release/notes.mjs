// Prints the changelog section for a version. Used as the GitHub release body.
//   node tools/release/notes.mjs 0.1.0
import { hasEntries, readChangelog, section } from "./changelog.mjs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node tools/release/notes.mjs <version>");
  process.exit(2);
}
const body = section(readChangelog(), version);
if (!hasEntries(body)) {
  console.error(`CHANGELOG.md has no entries under [${version}].`);
  process.exit(1);
}
console.log(body);

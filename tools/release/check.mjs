// The changelog gate. CI runs it on every pull request.
//   node tools/release/check.mjs staging   Unreleased must have entries
//   node tools/release/check.mjs main      the package version must be released
import { readFileSync } from "node:fs";
import { hasEntries, readChangelog, section } from "./changelog.mjs";

const base = process.argv[2];
const text = readChangelog();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (base === "staging") {
  const unreleased = section(text, "Unreleased");
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  // A release-preparation pull request empties Unreleased into a version.
  if (!hasEntries(unreleased) && !hasEntries(section(text, version))) {
    fail("Add a line under [Unreleased] in CHANGELOG.md describing this change.");
  }
  console.log("Changelog gate passed for staging.");
} else if (base === "main") {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  if (!hasEntries(section(text, version))) {
    fail(`CHANGELOG.md has no entries under [${version}]. Run: npm run release:prepare -- <version>`);
  }
  if (hasEntries(section(text, "Unreleased"))) {
    fail("Unreleased still has entries. Run release:prepare so they ship under a version.");
  }
  console.log(`Changelog gate passed for main: releasing ${version}.`);
} else {
  fail("Usage: node tools/release/check.mjs <staging|main>");
}

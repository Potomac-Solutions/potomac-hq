// Turns Unreleased into a version. Run on a branch off staging, then open a
// pull request into staging, and after that one from staging into main.
//   npm run release:prepare -- 0.1.0
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { CHANGELOG, hasEntries, readChangelog, section } from "./changelog.mjs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: npm run release:prepare -- <major.minor.patch>");
  process.exit(2);
}

const text = readChangelog();
if (section(text, version) !== null) {
  console.error(`CHANGELOG.md already has a [${version}] section.`);
  process.exit(1);
}
const unreleased = section(text, "Unreleased");
if (!hasEntries(unreleased)) {
  console.error("Nothing to release: Unreleased has no entries.");
  process.exit(1);
}

const today = Temporal.Now.plainDateISO("America/New_York").toString();
const heading = "## [Unreleased]";
const at = text.indexOf(heading);
const next = text.indexOf("\n## [", at + heading.length);
const rest = next === -1 ? "" : text.slice(next + 1);
const updated =
  text.slice(0, at) +
  `${heading}\n\n## [${version}] - ${today}\n\n${unreleased}\n` +
  (rest ? `\n${rest}` : "");
writeFileSync(CHANGELOG, updated);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npm, ["version", version, "--no-git-tag-version"], { stdio: "inherit" });
console.log(`Prepared ${version}. Review CHANGELOG.md, commit, and open a pull request.`);

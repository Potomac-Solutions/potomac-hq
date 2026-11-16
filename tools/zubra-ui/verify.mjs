// Zubra UI components are copied in and never edited here (decision 0001).
// This fails if a copy differs from the checksum recorded when it was copied,
// or if a file in the folder is not in the manifest.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const manifest = JSON.parse(readFileSync("zubra-ui.lock.json", "utf8"));
const dir = manifest.directory;
const problems = [];

for (const [file, expected] of Object.entries(manifest.components)) {
  let actual;
  try {
    actual = createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
  } catch {
    problems.push(`${file}: listed in zubra-ui.lock.json but missing from ${dir}`);
    continue;
  }
  if (actual !== expected) problems.push(`${file}: edited locally. Fix it upstream, copy it again, and update zubra-ui.lock.json`);
}
for (const file of readdirSync(dir)) {
  if (!(file in manifest.components)) problems.push(`${file}: in ${dir} but not in zubra-ui.lock.json`);
}

if (problems.length > 0) {
  console.error("Zubra UI check failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`Zubra UI check passed: ${Object.keys(manifest.components).length} components match commit ${manifest.commit.slice(0, 7)}.`);

// Proves the boundary rules catch what they claim to. Runs the real config
// over fixtures/ and compares the violations with the list below. A rule that
// stops firing, or starts firing on allowed code, fails CI.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const expected = {
  "src/alpha/domain/bad-uses-zubra.ts": ["core-no-zubra-or-ui-framework", "domain-imports-nothing-outside-itself"],
  "src/alpha/domain/bad-uses-node.ts": ["domain-imports-nothing-outside-itself"],
  "src/alpha/domain/bad-uses-application.ts": ["domain-imports-nothing-outside-itself"],
  "src/alpha/domain/bad.test.ts": ["domain-tests-stay-pure"],
  "src/shared/domain/bad-uses-alpha.ts": ["domain-imports-nothing-outside-itself"],
  "src/alpha/application/bad-reaches-into-shared-domain.ts": ["application-imports-domain-only", "no-other-module-internals"],
  "src/alpha/application/bad-uses-hono.ts": ["application-imports-domain-only", "core-no-zubra-or-ui-framework"],
  "src/alpha/application/bad-uses-infrastructure.ts": ["application-imports-domain-only"],
  "src/alpha/application/bad-reaches-into-beta.ts": ["application-imports-domain-only", "no-other-module-internals"],
  "src/alpha/infrastructure/bad-uses-api.ts": ["infrastructure-not-api-or-ui"],
  "src/alpha/api/bad-uses-domain.ts": ["api-imports-application-only"],
  "src/alpha/ui/bad-uses-application.ts": ["ui-imports-api-contracts-only"],
};

let json;
try {
  json = execFileSync(
    process.execPath,
    [
      join(root, "node_modules", "dependency-cruiser", "bin", "dependency-cruiser.mjs"),
      "src",
      "--config",
      join(root, ".dependency-cruiser.cjs"),
      "--output-type",
      "json",
    ],
    { cwd: join(here, "fixtures"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
} catch (error) {
  // depcruise exits non-zero when it finds violations, which is what we want here.
  json = error.stdout;
  if (!json) throw error;
}

const found = {};
for (const v of JSON.parse(json).summary.violations) {
  (found[v.from] ??= new Set()).add(v.rule.name);
}

const problems = [];
for (const [file, rules] of Object.entries(expected)) {
  const got = [...(found[file] ?? [])].sort();
  if (JSON.stringify(got) !== JSON.stringify([...rules].sort())) {
    problems.push(`${file}: expected [${rules.join(", ")}], got [${got.join(", ")}]`);
  }
}
for (const file of Object.keys(found)) {
  if (!(file in expected)) {
    problems.push(`${file}: allowed code was flagged by [${[...found[file]].join(", ")}]`);
  }
}

if (problems.length > 0) {
  console.error("Boundary self-test failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`Boundary self-test passed: ${Object.keys(expected).length} violations caught, allowed code left alone.`);

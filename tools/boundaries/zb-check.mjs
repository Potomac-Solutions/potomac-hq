// The boundary lint reads TypeScript, not Zubra components, so this holds
// .zb files to the same UI rule:
//
//   - A component lives in src/<module>/ui/, or is src/app.zb (the shell) or
//     src/error.zb (the error page).
//   - Its script may import @zubra packages, files in its own module's ui/
//     or api/contracts/, and the design system in src/shared/ui/.
//
// Everything else a page needs reaches it through `load`'s `context`.
//   node tools/boundaries/zb-check.mjs            checks src/
//   node tools/boundaries/zb-check.mjs --selftest  proves the rules fire
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function zbFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...zbFiles(path));
    else if (entry.name.endsWith(".zb")) found.push(path);
  }
  return found;
}

function importsOf(source) {
  const specifiers = [];
  for (const script of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const code = script[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const match of code.matchAll(/\bimport\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) specifiers.push(match[1]);
    for (const match of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Problems for every .zb file under root/src, as "path: message" lines. */
export function check(root) {
  const src = join(root, "src");
  const toPosix = (path) => relative(root, path).split(sep).join(posix.sep);
  const problems = [];

  for (const file of zbFiles(src)) {
    const name = toPosix(file);
    const top = name === "src/app.zb" || name === "src/error.zb";
    const module = /^src\/([^/]+)\/ui\//.exec(name)?.[1];
    if (!top && !module) {
      problems.push(`${name}: a component must live in src/<module>/ui/ (or be src/app.zb or src/error.zb)`);
      continue;
    }
    const allowed = [/^src\/shared\/ui\//];
    if (module) allowed.push(new RegExp(`^src/${module}/(ui|api/contracts)/`));

    for (const specifier of importsOf(readFileSync(file, "utf8"))) {
      if (/^@zubra\/[a-z-]+(\/.*)?$/.test(specifier)) continue;
      if (!specifier.startsWith(".")) {
        problems.push(`${name}: imports "${specifier}". A component may import only @zubra packages and UI files`);
        continue;
      }
      const target = toPosix(resolve(dirname(file), specifier));
      if (!allowed.some((pattern) => pattern.test(target))) {
        problems.push(`${name}: imports ${target}. A component may import only its own ui/ and api/contracts/, and src/shared/ui/`);
      }
    }
  }
  return problems.sort();
}

if (process.argv.includes("--selftest")) {
  const expected = [
    'src/alpha/domain/misplaced.zb: a component must live in src/<module>/ui/ (or be src/app.zb or src/error.zb)',
    'src/alpha/ui/bad-imports.zb: imports "hono". A component may import only @zubra packages and UI files',
    "src/alpha/ui/bad-imports.zb: imports src/alpha/application/service.ts. A component may import only its own ui/ and api/contracts/, and src/shared/ui/",
    "src/alpha/ui/bad-imports.zb: imports src/alpha/infrastructure/db.ts. A component may import only its own ui/ and api/contracts/, and src/shared/ui/",
    "src/alpha/ui/bad-imports.zb: imports src/beta/ui/other.zb. A component may import only its own ui/ and api/contracts/, and src/shared/ui/",
    "src/app.zb: imports src/alpha/ui/ok.zb. A component may import only its own ui/ and api/contracts/, and src/shared/ui/",
  ].sort();
  const found = check(join(here, "zb-fixtures"));
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    console.error("Component boundary self-test failed.\nExpected:\n  " + expected.join("\n  ") + "\nFound:\n  " + found.join("\n  "));
    process.exit(1);
  }
  console.log(`Component boundary self-test passed: ${expected.length} violations caught, allowed code left alone.`);
} else {
  const problems = check(join(here, "..", ".."));
  if (problems.length > 0) {
    console.error("Component boundary check failed:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log("Component boundary check passed.");
}

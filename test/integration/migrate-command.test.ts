// Runs the real command the deploy will run, against the real migrations
// folder, twice.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..", "..");

function run(env: Record<string, string>): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [join(root, "bin", "migrate.ts")], {
      env: { ...env, PATH: process.env["PATH"] ?? "" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const failed = error as { status: number; stderr: string };
    return { status: failed.status, output: failed.stderr };
  }
}

test("the migrate command applies the repo's migrations and is safe to repeat", () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-cli-"));
  try {
    const env = { HQ_DATABASE_PATH: join(dir, "nested", "hq.db") };
    const first = run(env);
    assert.equal(first.status, 0, first.output);
    const second = run(env);
    assert.equal(second.status, 0, second.output);
    assert.match(second.output, /Nothing to apply/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the migrate command refuses to guess where the database is", () => {
  const result = run({});
  assert.equal(result.status, 2);
  assert.match(result.output, /HQ_DATABASE_PATH/);
});

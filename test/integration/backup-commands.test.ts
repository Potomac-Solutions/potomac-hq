// The real commands, as Mikey will run them: make a key pair, back up, restore.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..", "..");
const PASSPHRASE = "a long test passphrase";

function run(script: string, args: string[], env: Record<string, string>): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [join(root, "bin", script), ...args], {
      env: { PATH: process.env["PATH"] ?? "", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const failed = error as { status: number; stderr: string; stdout: string };
    return { status: failed.status, output: failed.stdout + failed.stderr };
  }
}

test("keygen, backup and restore round-trip a real database", () => {
  const dir = mkdtempSync(join(tmpdir(), "hq-backup-cli-"));
  try {
    const db = join(dir, "hq.db");
    assert.equal(run("migrate.ts", [], { HQ_DATABASE_PATH: db }).status, 0);

    const key = join(dir, "hq-backup");
    const made = run("backup-keygen.ts", [key], { HQ_BACKUP_KEY_PASSPHRASE: PASSPHRASE });
    assert.equal(made.status, 0, made.output);
    assert.equal(statSync(`${key}.private.pem`).mode & 0o777, 0o600);
    assert.match(readFileSync(`${key}.private.pem`, "utf8"), /BEGIN ENCRYPTED PRIVATE KEY/);
    assert.equal(run("backup-keygen.ts", [key], { HQ_BACKUP_KEY_PASSPHRASE: PASSPHRASE }).status, 1, "never overwrites a key");

    const backups = join(dir, "backups");
    const saved = run("backup.ts", [], { HQ_DATABASE_PATH: db, HQ_BACKUP_PUBLIC_KEY_FILE: `${key}.public.pem`, HQ_BACKUP_DIR: backups });
    assert.equal(saved.status, 0, saved.output);
    const [file] = readdirSync(backups);
    assert.ok(file);

    const restoredPath = join(dir, "restored.db");
    const wrong = run("restore.ts", [join(backups, file), `${key}.private.pem`, restoredPath], { HQ_BACKUP_KEY_PASSPHRASE: "not the passphrase" });
    assert.equal(wrong.status, 1);
    assert.match(wrong.output, /does not open this backup, or its passphrase is wrong/);

    const restored = run("restore.ts", [join(backups, file), `${key}.private.pem`, restoredPath], { HQ_BACKUP_KEY_PASSPHRASE: PASSPHRASE });
    assert.equal(restored.status, 0, restored.output);
    assert.match(restored.output, /Integrity check: ok\. Migrations: \d+\. Activity events: 0\./);

    const again = run("restore.ts", [join(backups, file), `${key}.private.pem`, restoredPath], { HQ_BACKUP_KEY_PASSPHRASE: PASSPHRASE });
    assert.equal(again.status, 1, "never overwrites a database");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

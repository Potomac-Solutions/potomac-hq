// Keeps docs/authorization-matrix.md and the code in step. If someone edits
// one and not the other, this fails.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PERMISSIONS, ROLE_GRANTS } from "../../src/identity/index.ts";

const text = readFileSync(join(import.meta.dirname, "..", "..", "docs", "authorization-matrix.md"), "utf8");

type Row = { key: string; admin: boolean; manager: boolean; member: boolean; client: string };

function documented(): Row[] {
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    // | Action | `key` | Admin | Manager | Member | Client user |
    if (cells.length !== 8) continue;
    const key = /^`([^`]+)`$/.exec(cells[2] ?? "")?.[1];
    if (!key) continue;
    const yes = (cell: string | undefined) => {
      assert.ok(cell === "Yes" || cell === "No", `${key}: expected Yes or No, got "${cell}"`);
      return cell === "Yes";
    };
    rows.push({ key, admin: yes(cells[3]), manager: yes(cells[4]), member: yes(cells[5]), client: cells[6] ?? "" });
  }
  return rows;
}

test("the document lists exactly the permissions the code defines", () => {
  assert.deepEqual(documented().map((row) => row.key).sort(), [...PERMISSIONS].sort());
});

test("each role's grants match the document", () => {
  for (const row of documented()) {
    assert.equal(ROLE_GRANTS.admin.includes(row.key as never), row.admin, `admin ${row.key}`);
    assert.equal(ROLE_GRANTS.manager.includes(row.key as never), row.manager, `manager ${row.key}`);
    assert.equal(ROLE_GRANTS.member.includes(row.key as never), row.member, `member ${row.key}`);
  }
});

test("no permission is granted to client users yet", () => {
  for (const row of documented()) assert.match(row.client, /^No\b/, row.key);
});

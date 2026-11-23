import type { PasskeyAlgorithm, PasskeyJwk } from "../domain/passkey.ts";
import type { Passkey, PasskeyStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "id, user_id, credential_id, public_key, algorithm, sign_count, label, created_at, last_used_at";

function toPasskey(row: Record<string, unknown>): Passkey {
  return {
    id: row["id"] as Id,
    userId: row["user_id"] as Id,
    credentialId: String(row["credential_id"]),
    key: { algorithm: Number(row["algorithm"]) as PasskeyAlgorithm, jwk: JSON.parse(String(row["public_key"])) as PasskeyJwk },
    signCount: Number(row["sign_count"]),
    label: String(row["label"]),
    createdAt: String(row["created_at"]),
    lastUsedAt: (row["last_used_at"] as string | null) ?? null,
  };
}

export function sqlitePasskeyStore(db: Database): PasskeyStore {
  const listFor = db.prepare(`select ${COLUMNS} from passkey where user_id = ? order by created_at, rowid`);
  const byCredential = db.prepare(`select ${COLUMNS} from passkey where credential_id = ?`);
  const add = db.prepare(`insert into passkey (${COLUMNS}) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const used = db.prepare("update passkey set sign_count = ?, last_used_at = ? where id = ?");
  const remove = db.prepare("delete from passkey where id = ?");
  const setChallenge = db.prepare(
    `insert into passkey_challenge (session_hash, user_id, purpose, challenge, expires_at) values (?, ?, ?, ?, ?)
     on conflict (session_hash) do update set user_id = excluded.user_id, purpose = excluded.purpose, challenge = excluded.challenge, expires_at = excluded.expires_at`,
  );
  const getChallenge = db.prepare("select user_id, purpose, challenge, expires_at from passkey_challenge where session_hash = ?");
  const dropChallenge = db.prepare("delete from passkey_challenge where session_hash = ?");
  const dropExpired = db.prepare("delete from passkey_challenge where expires_at < ?");
  return {
    listFor: (userId) => listFor.all(userId).map(toPasskey),
    byCredential(credentialId) {
      const row = byCredential.get(credentialId);
      return row ? toPasskey(row) : null;
    },
    add(p) {
      add.run(p.id, p.userId, p.credentialId, JSON.stringify(p.key.jwk), p.key.algorithm, p.signCount, p.label, p.createdAt, p.lastUsedAt);
    },
    used(id, signCount, at) {
      used.run(signCount, at, id);
    },
    remove(id) {
      remove.run(id);
    },
    setChallenge(sessionHash, userId, purpose, challenge, expiresAt, now) {
      // Challenges nobody answered are swept whenever a new one is given.
      dropExpired.run(now);
      setChallenge.run(sessionHash, userId, purpose, challenge, expiresAt);
    },
    takeChallenge(sessionHash, userId, purpose, now) {
      const row = getChallenge.get(sessionHash);
      // Whatever it was, it is spent.
      dropChallenge.run(sessionHash);
      if (!row || row["user_id"] !== userId || row["purpose"] !== purpose || String(row["expires_at"]) < now) return null;
      return String(row["challenge"]);
    },
  };
}

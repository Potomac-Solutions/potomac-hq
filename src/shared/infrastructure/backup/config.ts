// Backup settings from the environment. All or nothing: a half-set
// configuration is an error at start, not a silent gap at 3 a.m.
import { readFileSync } from "node:fs";
import { directoryTarget, r2Target, type BackupTarget } from "./targets.ts";

export type BackupConfig = { readonly target: BackupTarget; readonly publicKeyPem: string };

const R2_VARS = ["HQ_BACKUP_R2_ACCOUNT_ID", "HQ_BACKUP_R2_BUCKET", "HQ_BACKUP_R2_ACCESS_KEY_ID", "HQ_BACKUP_R2_SECRET_ACCESS_KEY"] as const;

/**
 * null when backups are not set up at all. Throws when they are half set up.
 *   HQ_BACKUP_PUBLIC_KEY         the public key, as PEM text (or HQ_BACKUP_PUBLIC_KEY_FILE)
 *   HQ_BACKUP_R2_*               the R2 bucket and its access key, and
 *   HQ_BACKUP_R2_PREFIX          an optional folder in the bucket, such as "production/"
 *   HQ_BACKUP_DIR                or a local folder instead of R2
 */
export function backupConfigFrom(env: NodeJS.ProcessEnv): BackupConfig | null {
  const keyFile = env["HQ_BACKUP_PUBLIC_KEY_FILE"];
  const publicKeyPem = env["HQ_BACKUP_PUBLIC_KEY"] ?? (keyFile ? readFileSync(keyFile, "utf8") : undefined);
  const r2Set = R2_VARS.filter((name) => env[name]);
  const dir = env["HQ_BACKUP_DIR"];

  if (!publicKeyPem && r2Set.length === 0 && !dir) return null;
  if (!publicKeyPem) throw new Error("Backups are partly set up: HQ_BACKUP_PUBLIC_KEY is missing.");
  if (!publicKeyPem.includes("BEGIN PUBLIC KEY")) throw new Error("HQ_BACKUP_PUBLIC_KEY must be a PEM public key. Never give the server the private key.");
  if (dir && r2Set.length > 0) throw new Error("Set either HQ_BACKUP_DIR or the HQ_BACKUP_R2_ settings, not both.");
  if (dir) return { target: directoryTarget(dir), publicKeyPem };
  if (r2Set.length !== R2_VARS.length) {
    const missing = R2_VARS.filter((name) => !env[name]);
    throw new Error(`Backups are partly set up. Missing: ${missing.join(", ")}`);
  }
  return {
    publicKeyPem,
    target: r2Target({
      accountId: env["HQ_BACKUP_R2_ACCOUNT_ID"] as string,
      bucket: env["HQ_BACKUP_R2_BUCKET"] as string,
      accessKeyId: env["HQ_BACKUP_R2_ACCESS_KEY_ID"] as string,
      secretAccessKey: env["HQ_BACKUP_R2_SECRET_ACCESS_KEY"] as string,
      ...(env["HQ_BACKUP_R2_PREFIX"] ? { prefix: env["HQ_BACKUP_R2_PREFIX"] } : {}),
    }),
  };
}

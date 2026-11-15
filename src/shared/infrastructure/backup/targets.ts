// Where sealed backups go. One interface, so swapping storage changes one file.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { amzDate, authorization, sha256Hex } from "./sigv4.ts";

export type BackupTarget = {
  readonly describe: string;
  put(name: string, body: Uint8Array): Promise<void>;
};

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/;

function checkName(name: string): void {
  if (!SAFE_NAME.test(name)) throw new Error(`Refusing an unsafe backup name: ${name}`);
}

/** A folder on disk. For local use and tests. */
export function directoryTarget(dir: string): BackupTarget & { list(): string[]; get(name: string): Buffer } {
  return {
    describe: `folder ${dir}`,
    async put(name, body) {
      checkName(name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), body, { mode: 0o600 });
    },
    list: () => readdirSync(dir).filter((name) => SAFE_NAME.test(name)).sort(),
    get(name) {
      checkName(name);
      return readFileSync(join(dir, name));
    },
  };
}

export type R2Config = {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Folder inside the bucket, such as "production/". */
  readonly prefix?: string;
};

/** A Cloudflare R2 bucket, through its S3 API. */
export function r2Target(config: R2Config, deps: { fetch?: typeof fetch; now?: () => string } = {}): BackupTarget {
  const send = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date().toISOString());
  const prefix = config.prefix ?? "";
  return {
    describe: `R2 bucket ${config.bucket}${prefix ? `/${prefix}` : ""}`,
    async put(name, body) {
      checkName(name);
      const url = new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${prefix}${name}`);
      const payloadHash = sha256Hex(body);
      const date = amzDate(now());
      const headers = {
        "content-type": "application/octet-stream",
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": date,
      };
      const signed = authorization({
        method: "PUT",
        url,
        headers,
        payloadHash,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        region: "auto",
        service: "s3",
        amzDate: date,
      });
      const response = await send(url, { method: "PUT", headers: { ...headers, authorization: signed }, body: Buffer.from(body) });
      if (!response.ok) {
        // The body may name the bucket, never the secret. Keep only the status.
        throw new Error(`R2 refused the backup upload: HTTP ${response.status}`);
      }
    },
  };
}

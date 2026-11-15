// A backup file only Mikey can open (docs/tool-boundaries.md, "Data
// protection"). The server holds a public key, so it can seal backups but
// never open them. Each backup gets a fresh AES-256-GCM key, which is sealed
// with RSA-OAEP (SHA-256) to that public key. Only the private key, which
// never touches the server, can unseal it.
//
// Layout: "HQBACKUP1\n" + one line of JSON (the header) + "\n" + ciphertext.
import { constants, createCipheriv, createDecipheriv, createHash, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";

const MAGIC = "HQBACKUP1\n";

type Header = {
  readonly v: 1;
  readonly alg: "RSA-OAEP-256/AES-256-GCM";
  readonly key: string;
  readonly iv: string;
  readonly tag: string;
  readonly sha256: string;
  readonly createdAt: string;
};

export class BackupFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFileError";
  }
}

export function seal(plain: Uint8Array, publicKeyPem: string, createdAt: string): Buffer {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(MAGIC));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const header: Header = {
    v: 1,
    alg: "RSA-OAEP-256/AES-256-GCM",
    key: publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key).toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    sha256: createHash("sha256").update(plain).digest("hex"),
    createdAt,
  };
  key.fill(0);
  return Buffer.concat([Buffer.from(MAGIC), Buffer.from(JSON.stringify(header)), Buffer.from("\n"), body]);
}

export function open(sealed: Uint8Array, privateKey: { key: string; passphrase?: string }): { plain: Buffer; createdAt: string } {
  const buffer = Buffer.from(sealed);
  if (buffer.subarray(0, MAGIC.length).toString() !== MAGIC) throw new BackupFileError("Not a Potomac HQ backup file.");
  const end = buffer.indexOf(0x0a, MAGIC.length);
  if (end === -1) throw new BackupFileError("The backup file's header is cut off.");
  let header: Header;
  try {
    header = JSON.parse(buffer.subarray(MAGIC.length, end).toString()) as Header;
  } catch {
    throw new BackupFileError("The backup file's header is not readable.");
  }
  if (header.v !== 1 || header.alg !== "RSA-OAEP-256/AES-256-GCM") throw new BackupFileError("This backup was written in a format this version cannot read.");

  let key: Buffer;
  try {
    key = privateDecrypt(
      { ...privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(header.key, "base64"),
    );
  } catch {
    throw new BackupFileError("This private key does not open this backup, or its passphrase is wrong.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAAD(Buffer.from(MAGIC));
  decipher.setAuthTag(Buffer.from(header.tag, "base64"));
  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(buffer.subarray(end + 1)), decipher.final()]);
  } catch {
    throw new BackupFileError("The backup file has been changed or damaged.");
  } finally {
    key.fill(0);
  }
  if (createHash("sha256").update(plain).digest("hex") !== header.sha256) throw new BackupFileError("The backup's contents do not match its checksum.");
  return { plain, createdAt: header.createdAt };
}

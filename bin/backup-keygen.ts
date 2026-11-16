// Makes the key pair for backups. Run it on your own computer, never on the
// server. The public key goes to the server (HQ_BACKUP_PUBLIC_KEY). The
// private key opens backups: keep it, and its passphrase, somewhere safe and
// off the server, such as a password manager.
//   HQ_BACKUP_KEY_PASSPHRASE=... npm run backup:keygen -- ./hq-backup
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const base = process.argv[2];
const passphrase = process.env["HQ_BACKUP_KEY_PASSPHRASE"];
if (!base) {
  console.error("Usage: HQ_BACKUP_KEY_PASSPHRASE=<passphrase> npm run backup:keygen -- <file name without extension>");
  process.exit(2);
}
if (!passphrase || passphrase.length < 16) {
  console.error("Set HQ_BACKUP_KEY_PASSPHRASE to a passphrase of 16 or more characters. It protects the private key file.");
  process.exit(2);
}
for (const path of [`${base}.private.pem`, `${base}.public.pem`]) {
  if (existsSync(path)) {
    console.error(`${path} already exists. Refusing to overwrite a key.`);
    process.exit(1);
  }
}
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 4096,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase },
});
writeFileSync(`${base}.private.pem`, privateKey, { mode: 0o600 });
writeFileSync(`${base}.public.pem`, publicKey, { mode: 0o644 });
console.log(`Wrote ${base}.public.pem: give this to the server as HQ_BACKUP_PUBLIC_KEY.`);
console.log(`Wrote ${base}.private.pem: this opens backups. Keep it and the passphrase off the server.`);

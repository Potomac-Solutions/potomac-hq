// Time-based one-time codes (RFC 6238, with RFC 4226), as authenticator apps
// make them: HMAC-SHA1 over the 30-second step, six digits. Only node:crypto.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TwoFactorCrypto } from "../application/ports.ts";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// Recovery codes leave out 0, 1, O and I, which are easy to misread.
const RECOVERY = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one 30-second step. */
export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] as number) & 15;
  const number = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}

export const stepOf = (ms: number): number => Math.floor(ms / 30_000);

export const totpCrypto: TwoFactorCrypto = {
  // 20 random bytes: 32 base32 letters, what RFC 4226 recommends.
  newSecret: () => base32(randomBytes(20)),
  verify(secret, code, atMs) {
    const now = stepOf(atMs);
    // The step before and after too: a phone's clock is often a little off.
    for (const step of [now - 1, now, now + 1]) {
      const expected = Buffer.from(codeAt(secret, step));
      if (timingSafeEqual(expected, Buffer.from(code.padEnd(6).slice(0, 6)))) return step;
    }
    return null;
  },
  newRecoveryCode() {
    const bytes = randomBytes(10);
    return Array.from(bytes, (byte) => RECOVERY[byte % RECOVERY.length]).join("");
  },
  hash: (text) => createHash("sha256").update(text).digest("hex"),
};

/** The kit's session key for a request: a hash of the session id in its cookie, as the kit stores it. */
export function sessionKeyOf(cookieHeader: string, cookieName: string): string | null {
  const id = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  return id ? createHash("sha256").update(id).digest("hex") : null;
}

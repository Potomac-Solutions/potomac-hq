// The cryptography passkeys need, from node:crypto alone: a random
// challenge, SHA-256, and checking an ES256, RS256 or EdDSA signature.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { toBase64Url } from "../domain/passkey.ts";
import type { PasskeyCrypto } from "../application/ports.ts";

export const passkeyCrypto: PasskeyCrypto = {
  challenge: () => toBase64Url(randomBytes(32)),
  sha256: (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest()),
  verify(key, data, signature) {
    try {
      const publicKey = createPublicKey({ key: key.jwk as never, format: "jwk" });
      // ES256 signatures arrive DER-encoded, which is what verify() expects. Ed25519 hashes for itself.
      return verify(key.algorithm === -8 ? null : "sha256", data, publicKey, signature);
    } catch {
      return false;
    }
  },
};

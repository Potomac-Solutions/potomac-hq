// A software passkey for tests: an ES256 key pair that answers WebAuthn
// challenges the way an authenticator and a browser would.
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { toBase64Url } from "../../src/identity/domain/passkey.ts";

const text = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash("sha256").update(bytes).digest());
const count = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

export type SoftPasskey = {
  readonly id: string;
  /** What a browser would send after navigator.credentials.create. */
  register(options: { challenge: string }, origin: string): string;
  /** What a browser would send after navigator.credentials.get. `counter` overrides the authenticator's own count. */
  assert(options: { challenge: string }, origin: string, change?: { counter?: number; rpId?: string; privateKey?: KeyObject }): string;
};

export function softPasskey(): SoftPasskey {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  const credentialId = sha256(concat(x, y)).slice(0, 20);
  const cose = concat([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20], x, [0x22, 0x58, 0x20], y);
  let uses = 0;
  const clientData = (type: string, challenge: string, origin: string) => text(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const rpHash = (origin: string, rpId?: string) => sha256(text(rpId ?? new URL(origin).hostname));
  return {
    id: toBase64Url(credentialId),
    register(options, origin) {
      const authData = concat(rpHash(origin), [0x45], count(0), new Uint8Array(16), [0, credentialId.length], credentialId, cose);
      const attestationObject = concat([0xa3, 0x63], text("fmt"), [0x64], text("none"), [0x67], text("attStmt"), [0xa0, 0x68], text("authData"), [0x58, authData.length], authData);
      return JSON.stringify({ id: toBase64Url(credentialId), clientDataJSON: toBase64Url(clientData("webauthn.create", options.challenge, origin)), attestationObject: toBase64Url(attestationObject) });
    },
    assert(options, origin, change = {}) {
      uses += 1;
      const authenticatorData = concat(rpHash(origin, change.rpId), [0x05], count(change.counter ?? uses));
      const client = clientData("webauthn.get", options.challenge, origin);
      const signature = sign("sha256", concat(authenticatorData, sha256(client)), change.privateKey ?? privateKey);
      return JSON.stringify({ id: toBase64Url(credentialId), clientDataJSON: toBase64Url(client), authenticatorData: toBase64Url(authenticatorData), signature: toBase64Url(new Uint8Array(signature)) });
    },
  };
}

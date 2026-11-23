// Passkeys (WebAuthn), as a second step at sign-in. This file reads what a
// browser sends back and checks everything that needs no cryptography: the
// client data, the authenticator data and the public key inside it. Hashing
// and checking signatures are done by the caller (see the application
// layer). Only "none" attestation is asked for, so there is no attestation
// statement to check: HQ trusts the key because the signed-in person
// registered it over their own session.
import { err, ok, type Result } from "../../shared/domain/result.ts";

/** The COSE algorithms HQ accepts: ES256, RS256 and EdDSA. */
export const PASSKEY_ALGORITHMS = [-7, -257, -8] as const;
export type PasskeyAlgorithm = (typeof PASSKEY_ALGORITHMS)[number];
export type PasskeyJwk = { readonly kty: "EC"; readonly crv: "P-256"; readonly x: string; readonly y: string } | { readonly kty: "RSA"; readonly n: string; readonly e: string } | { readonly kty: "OKP"; readonly crv: "Ed25519"; readonly x: string };
export type PasskeyKey = { readonly algorithm: PasskeyAlgorithm; readonly jwk: PasskeyJwk };

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += B64[c & 63];
  }
  return out;
}

/** Bytes from base64url (padding allowed), or null when it isn't base64url. */
export function fromBase64Url(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]*$/.test(clean) || clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const char of clean) {
    value = (value << 6) | B64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 255;
    }
  }
  return out;
}

// ── CBOR, as much of it as an authenticator sends ─────────────────────────

type Cbor = number | string | Uint8Array | Cbor[] | Map<number | string, Cbor> | boolean | null;

/** Reads one CBOR value. Throws on anything malformed or not understood. */
export function readCbor(bytes: Uint8Array, start = 0): { readonly value: Cbor; readonly end: number } {
  let at = start;
  const need = (n: number) => {
    if (at + n > bytes.length) throw new Error("cbor: cut short");
  };
  const read = (depth: number): Cbor => {
    if (depth > 8) throw new Error("cbor: too deep");
    need(1);
    const first = bytes[at++] as number;
    const major = first >> 5;
    const info = first & 31;
    let length = info;
    if (info === 24) {
      need(1);
      length = bytes[at++] as number;
    } else if (info === 25) {
      need(2);
      length = ((bytes[at] as number) << 8) | (bytes[at + 1] as number);
      at += 2;
    } else if (info === 26) {
      need(4);
      length = (bytes[at] as number) * 2 ** 24 + (((bytes[at + 1] as number) << 16) | ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number));
      at += 4;
    } else if (info > 23 && !(major === 7 && info < 24)) {
      throw new Error("cbor: unsupported length");
    }
    switch (major) {
      case 0:
        return length;
      case 1:
        return -1 - length;
      case 2: {
        need(length);
        const out = bytes.slice(at, at + length);
        at += length;
        return out;
      }
      case 3: {
        need(length);
        const out = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(at, at + length));
        at += length;
        return out;
      }
      case 4: {
        if (length > 64) throw new Error("cbor: too long");
        return Array.from({ length }, () => read(depth + 1));
      }
      case 5: {
        if (length > 64) throw new Error("cbor: too long");
        const map = new Map<number | string, Cbor>();
        for (let i = 0; i < length; i += 1) {
          const key = read(depth + 1);
          if (typeof key !== "number" && typeof key !== "string") throw new Error("cbor: unsupported key");
          map.set(key, read(depth + 1));
        }
        return map;
      }
      default:
        if (major === 7 && info === 20) return false;
        if (major === 7 && info === 21) return true;
        if (major === 7 && info === 22) return null;
        throw new Error("cbor: unsupported type");
    }
  };
  const value = read(0);
  return { value, end: at };
}

/** A COSE public key as a JWK, or null when it is not one HQ accepts. */
export function coseToKey(cose: Cbor): PasskeyKey | null {
  if (!(cose instanceof Map)) return null;
  const kty = cose.get(1);
  const alg = cose.get(3);
  const bytes = (key: number, length?: number): string | null => {
    const value = cose.get(key);
    return value instanceof Uint8Array && value.length > 0 && (length === undefined || value.length === length) ? toBase64Url(value) : null;
  };
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    const x = bytes(-2, 32);
    const y = bytes(-3, 32);
    return x && y ? { algorithm: -7, jwk: { kty: "EC", crv: "P-256", x, y } } : null;
  }
  if (kty === 3 && alg === -257) {
    const n = bytes(-1);
    const e = bytes(-2);
    // At least 2048 bits.
    return n && e && (cose.get(-1) as Uint8Array).length >= 256 ? { algorithm: -257, jwk: { kty: "RSA", n, e } } : null;
  }
  if (kty === 1 && alg === -8 && cose.get(-1) === 6) {
    const x = bytes(-2, 32);
    return x ? { algorithm: -8, jwk: { kty: "OKP", crv: "Ed25519", x } } : null;
  }
  return null;
}

export type AuthenticatorData = {
  readonly rpIdHash: Uint8Array;
  readonly userPresent: boolean;
  readonly userVerified: boolean;
  readonly signCount: number;
  /** Present when a credential was made: at registration. */
  readonly credential: { readonly id: Uint8Array; readonly key: PasskeyKey } | null;
};

/** Reads authenticator data: 32 bytes of RP id hash, flags, a counter, and at registration the new credential. */
export function readAuthenticatorData(bytes: Uint8Array): AuthenticatorData | null {
  if (bytes.length < 37) return null;
  const flags = bytes[32] as number;
  const signCount = (bytes[33] as number) * 2 ** 24 + (((bytes[34] as number) << 16) | ((bytes[35] as number) << 8) | (bytes[36] as number));
  let credential: AuthenticatorData["credential"] = null;
  if (flags & 0x40) {
    // 16 bytes of authenticator model id, a two-byte length, the credential id, then its COSE key.
    if (bytes.length < 55) return null;
    const length = ((bytes[53] as number) << 8) | (bytes[54] as number);
    if (length < 1 || length > 1023 || bytes.length < 55 + length + 1) return null;
    const id = bytes.slice(55, 55 + length);
    try {
      const key = coseToKey(readCbor(bytes, 55 + length).value);
      if (!key) return null;
      credential = { id, key };
    } catch {
      return null;
    }
  }
  return { rpIdHash: bytes.slice(0, 32), userPresent: (flags & 0x01) !== 0, userVerified: (flags & 0x04) !== 0, signCount, credential };
}

/** The authenticator data inside an attestation object. */
export function authDataOfAttestation(attestationObject: Uint8Array): Uint8Array | null {
  try {
    const { value } = readCbor(attestationObject);
    const data = value instanceof Map ? value.get("authData") : null;
    return data instanceof Uint8Array ? data : null;
  } catch {
    return null;
  }
}

export type PasskeyError = "passkey-malformed" | "passkey-wrong-kind" | "passkey-challenge" | "passkey-origin" | "passkey-site" | "passkey-not-present" | "passkey-key";

/** What the browser says it did: the right kind of ceremony, HQ's challenge, from HQ's own address. */
export function checkClientData(clientDataJson: Uint8Array, expect: { readonly type: "webauthn.create" | "webauthn.get"; readonly challenge: string; readonly origins: readonly string[] }): Result<true, PasskeyError> {
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(clientDataJson));
  } catch {
    return err("passkey-malformed");
  }
  if (typeof data !== "object" || data === null) return err("passkey-malformed");
  const { type, challenge, origin, crossOrigin } = data as Record<string, unknown>;
  if (type !== expect.type) return err("passkey-wrong-kind");
  if (typeof challenge !== "string" || challenge.length === 0 || challenge.replace(/=+$/, "") !== expect.challenge) return err("passkey-challenge");
  if (typeof origin !== "string" || !expect.origins.includes(origin) || crossOrigin === true) return err("passkey-origin");
  return ok(true);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

export type RegistrationInput = { readonly clientDataJson: Uint8Array; readonly attestationObject: Uint8Array };
export type Expected = { readonly challenge: string; readonly origins: readonly string[]; readonly rpIdHash: Uint8Array };

/** A new passkey, checked: answers its id, its public key and its counter. */
export function checkRegistration(input: RegistrationInput, expect: Expected): Result<{ readonly credentialId: string; readonly key: PasskeyKey; readonly signCount: number }, PasskeyError> {
  const client = checkClientData(input.clientDataJson, { type: "webauthn.create", challenge: expect.challenge, origins: expect.origins });
  if (!client.ok) return client;
  const raw = authDataOfAttestation(input.attestationObject);
  const data = raw ? readAuthenticatorData(raw) : null;
  if (!data) return err("passkey-malformed");
  if (!sameBytes(data.rpIdHash, expect.rpIdHash)) return err("passkey-site");
  if (!data.userPresent) return err("passkey-not-present");
  if (!data.credential) return err("passkey-key");
  return ok({ credentialId: toBase64Url(data.credential.id), key: data.credential.key, signCount: data.signCount });
}

export type AssertionInput = { readonly clientDataJson: Uint8Array; readonly authenticatorData: Uint8Array };

/**
 * A passkey used, checked as far as it can be without the signature:
 * answers the counter. The caller then checks the signature over the
 * authenticator data followed by the SHA-256 of the client data.
 */
export function checkAssertion(input: AssertionInput, expect: Expected): Result<{ readonly signCount: number }, PasskeyError> {
  const client = checkClientData(input.clientDataJson, { type: "webauthn.get", challenge: expect.challenge, origins: expect.origins });
  if (!client.ok) return client;
  const data = readAuthenticatorData(input.authenticatorData);
  if (!data) return err("passkey-malformed");
  if (!sameBytes(data.rpIdHash, expect.rpIdHash)) return err("passkey-site");
  if (!data.userPresent) return err("passkey-not-present");
  return ok({ signCount: data.signCount });
}

/**
 * Whether a counter says the passkey was copied: an authenticator that
 * counts must count up. One that keeps no counter always sends 0.
 */
export const counterWentBack = (stored: number, sent: number): boolean => (stored !== 0 || sent !== 0) && sent <= stored;

/** A name for a passkey, as the person typed it, or a plain default. */
export function passkeyLabel(typed: string | null | undefined): string | null {
  const label = (typed ?? "").trim().replace(/\s+/g, " ") || "Passkey";
  return label.length <= 60 ? label : null;
}

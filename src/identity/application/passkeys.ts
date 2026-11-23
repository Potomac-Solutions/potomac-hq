// Passkeys as the second step at sign-in. A passkey is a key pair kept by a
// phone, a computer or a security key; HQ keeps only the public half. A
// person can turn two-factor sign-in on with a passkey alone, or add
// passkeys beside their authenticator app. Their own, so there is no
// permission beyond being signed in. Each change writes an activity event;
// no key, challenge or signature is ever written to the activity log.
import { checkAssertion, checkRegistration, counterWentBack, fromBase64Url, PASSKEY_ALGORITHMS, passkeyLabel, toBase64Url, type PasskeyError } from "../domain/passkey.ts";
import { RECOVERY_CODE_COUNT, showRecoveryCode } from "../domain/two-factor.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { Passkey } from "./ports.ts";
import type { TwoFactorDeps } from "./two-factor.ts";

/** Which site the browser is on: the name passkeys are bound to (the host, no port) and the address it must report. */
export type PasskeySite = { readonly rpId: string; readonly origins: readonly string[] };

/** Most passkeys one person can have. */
export const MAX_PASSKEYS = 10;
const CHALLENGE_MINUTES = 5;
const text = (value: string) => new TextEncoder().encode(value);
const expiry = (deps: TwoFactorDeps) => Temporal.Instant.from(deps.clock()).add({ minutes: CHALLENGE_MINUTES }).toString();

/**
 * What the browser needs to make a new passkey. The challenge is kept for
 * this session, for one use within five minutes.
 */
export function passkeyRegistrationOptions(deps: TwoFactorDeps, userId: Id | null, sessionHash: string | null, site: PasskeySite): Result<Record<string, unknown>, "forbidden" | "too-many"> {
  const user = userId === null ? null : deps.users.get(userId);
  if (userId === null || !user || !sessionHash) return err("forbidden");
  const existing = deps.passkeys.listFor(userId);
  if (existing.length >= MAX_PASSKEYS) return err("too-many");
  const challenge = deps.webauthn.challenge();
  deps.passkeys.setChallenge(sessionHash, userId, "register", challenge, expiry(deps), deps.clock());
  return ok({
    challenge,
    rp: { name: "Potomac HQ", id: site.rpId },
    user: { id: toBase64Url(text(userId)), name: user.email, displayName: user.name },
    pubKeyCredParams: PASSKEY_ALGORITHMS.map((alg) => ({ type: "public-key", alg })),
    timeout: CHALLENGE_MINUTES * 60_000,
    attestation: "none",
    // A second step, after the password: the passkey need not know who it is for.
    authenticatorSelection: { residentKey: "discouraged", userVerification: "preferred" },
    excludeCredentials: existing.map((one) => ({ type: "public-key", id: one.credentialId })),
  });
}

type Sent = Record<string, unknown>;
function parse(json: string): Sent | null {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null ? (value as Sent) : null;
  } catch {
    return null;
  }
}
const bytesOf = (sent: Sent, key: string): Uint8Array | null => (typeof sent[key] === "string" && (sent[key] as string).length <= 20_000 ? fromBase64Url(sent[key] as string) : null);

export type RegisterError = "forbidden" | "passkey-expired" | "label-too-long" | "passkey-known" | "too-many" | PasskeyError;

/**
 * Keeps a new passkey. If two-factor sign-in was off, this turns it on, with
 * no authenticator app, and answers the recovery codes, shown once; the
 * session it was done in counts as passed.
 */
export function registerPasskey(deps: TwoFactorDeps, userId: Id | null, sessionHash: string | null, site: PasskeySite, input: { readonly label?: string | null; readonly credential: string }): Result<{ readonly passkey: Passkey; readonly recoveryCodes: readonly string[] | null }, RegisterError> {
  if (userId === null || !deps.users.get(userId) || !sessionHash) return err("forbidden");
  const label = passkeyLabel(input.label);
  if (label === null) return err("label-too-long");
  const sent = parse(input.credential);
  const clientDataJson = sent ? bytesOf(sent, "clientDataJSON") : null;
  const attestationObject = sent ? bytesOf(sent, "attestationObject") : null;
  if (!clientDataJson || !attestationObject) return err("passkey-malformed");
  return deps.transact(() => {
    const challenge = deps.passkeys.takeChallenge(sessionHash, userId, "register", deps.clock());
    if (!challenge) return err("passkey-expired");
    const checked = checkRegistration({ clientDataJson, attestationObject }, { challenge, origins: site.origins, rpIdHash: deps.webauthn.sha256(text(site.rpId)) });
    if (!checked.ok) return checked;
    if (deps.passkeys.byCredential(checked.value.credentialId)) return err("passkey-known");
    if (deps.passkeys.listFor(userId).length >= MAX_PASSKEYS) return err("too-many");
    const at = deps.clock();
    let recoveryCodes: string[] | null = null;
    if (deps.twoFactor.get(userId)?.confirmed !== true) {
      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => deps.totp.newRecoveryCode());
      deps.twoFactor.confirmWithoutApp(userId, deps.totp.newSecret(), codes.map((one) => deps.totp.hash(one)), at);
      deps.twoFactor.markSession(sessionHash, userId, at);
      recordActivity(deps, { actorId: userId, action: "user.two-factor-on", recordType: "user", recordId: userId, context: { with: "passkey" } });
      recoveryCodes = codes.map(showRecoveryCode);
    }
    const passkey: Passkey = { id: deps.newId(), userId, credentialId: checked.value.credentialId, key: checked.value.key, signCount: checked.value.signCount, label, createdAt: at, lastUsedAt: null };
    deps.passkeys.add(passkey);
    recordActivity(deps, { actorId: userId, action: "user.passkey-added", recordType: "user", recordId: userId, context: { passkeyId: passkey.id } });
    return ok({ passkey, recoveryCodes });
  });
}

/**
 * Removes one of your passkeys. The last way to pass the second step can't
 * be removed: turn two-factor sign-in off instead.
 */
export function removePasskey(deps: TwoFactorDeps, userId: Id | null, passkeyId: Id): Result<true, "forbidden" | "not-found" | "last-method"> {
  if (userId === null || !deps.users.get(userId)) return err("forbidden");
  return deps.transact(() => {
    const mine = deps.passkeys.listFor(userId);
    if (!mine.some((one) => one.id === passkeyId)) return err("not-found");
    if (mine.length === 1 && deps.twoFactor.get(userId)?.app !== true) return err("last-method");
    deps.passkeys.remove(passkeyId);
    recordActivity(deps, { actorId: userId, action: "user.passkey-removed", recordType: "user", recordId: userId, context: { passkeyId } });
    return ok(true as const);
  });
}

/** What the browser needs to use one of this person's passkeys. Null when they have none. */
export function passkeyVerifyOptions(deps: TwoFactorDeps, userId: Id, sessionHash: string, site: PasskeySite): Record<string, unknown> | null {
  const mine = deps.passkeys.listFor(userId);
  if (mine.length === 0) return null;
  const challenge = deps.webauthn.challenge();
  deps.passkeys.setChallenge(sessionHash, userId, "verify", challenge, expiry(deps), deps.clock());
  return { challenge, rpId: site.rpId, timeout: CHALLENGE_MINUTES * 60_000, userVerification: "preferred", allowCredentials: mine.map((one) => ({ type: "public-key", id: one.credentialId })) };
}

export type ProveError = "passkey-expired" | "passkey-unknown" | "passkey-signature" | "passkey-copied" | PasskeyError;

/**
 * Checks a passkey was just used by this person in this session: the
 * challenge HQ gave it, from HQ's own address, signed by a key they
 * registered. Call inside a transaction.
 */
export function provePasskey(deps: TwoFactorDeps, userId: Id, sessionHash: string, site: PasskeySite, assertion: string): Result<Passkey, ProveError> {
  const sent = parse(assertion);
  const clientDataJson = sent ? bytesOf(sent, "clientDataJSON") : null;
  const authenticatorData = sent ? bytesOf(sent, "authenticatorData") : null;
  const signature = sent ? bytesOf(sent, "signature") : null;
  const id = sent && typeof sent["id"] === "string" ? sent["id"].replace(/=+$/, "") : null;
  if (!clientDataJson || !authenticatorData || !signature || !id) return err("passkey-malformed");
  const challenge = deps.passkeys.takeChallenge(sessionHash, userId, "verify", deps.clock());
  if (!challenge) return err("passkey-expired");
  const passkey = deps.passkeys.byCredential(id);
  if (!passkey || passkey.userId !== userId) return err("passkey-unknown");
  const checked = checkAssertion({ clientDataJson, authenticatorData }, { challenge, origins: site.origins, rpIdHash: deps.webauthn.sha256(text(site.rpId)) });
  if (!checked.ok) return checked;
  const hash = deps.webauthn.sha256(clientDataJson);
  const signed = new Uint8Array(authenticatorData.length + hash.length);
  signed.set(authenticatorData);
  signed.set(hash, authenticatorData.length);
  if (!deps.webauthn.verify(passkey.key, signed, signature)) return err("passkey-signature");
  if (counterWentBack(passkey.signCount, checked.value.signCount)) return err("passkey-copied");
  deps.passkeys.used(passkey.id, checked.value.signCount, deps.clock());
  return ok(passkey);
}

/** The second step at sign-in, with a passkey. The caller limits how often this may be tried. */
export function passSecondStepWithPasskey(deps: TwoFactorDeps, userId: Id, sessionHash: string, site: PasskeySite, assertion: string): Result<true, ProveError | "not-on"> {
  return deps.transact(() => {
    if (deps.twoFactor.get(userId)?.confirmed !== true) return err("not-on");
    const proved = provePasskey(deps, userId, sessionHash, site, assertion);
    if (!proved.ok) return proved;
    deps.twoFactor.markSession(sessionHash, userId, deps.clock());
    recordActivity(deps, { actorId: userId, action: "user.two-factor-passed", recordType: "user", recordId: userId, context: { with: "passkey" } });
    return ok(true as const);
  });
}

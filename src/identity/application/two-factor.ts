// Two-factor sign-in for HQ accounts: after the password, a code from an
// authenticator app. Optional for each person. Each change checks its
// permission and writes an activity event. Neither a code, a secret nor a
// recovery code is ever written to the activity log.
import { appLink, cleanCode, cleanRecoveryCode, groupSecret, RECOVERY_CODE_COUNT, showRecoveryCode } from "../domain/two-factor.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import { authorize } from "./authorize.ts";
import type { TwoFactorCrypto, TwoFactorStore, UserStore } from "./ports.ts";

export type TwoFactorDeps = ActivityDeps & {
  readonly users: UserStore;
  readonly twoFactor: TwoFactorStore;
  readonly totp: TwoFactorCrypto;
  readonly transact: Transact;
};

const nowMs = (deps: TwoFactorDeps) => Temporal.Instant.from(deps.clock()).epochMilliseconds;

export type TwoFactorStatus = {
  readonly on: boolean;
  /** Set while turning it on: what to put into the app. */
  readonly setup: { readonly key: string; readonly link: string } | null;
  readonly recoveryLeft: number;
};

/** Where the signed-in person stands. Their own, so no permission beyond being signed in. */
export function twoFactorStatus(deps: TwoFactorDeps, userId: Id): TwoFactorStatus {
  const record = deps.twoFactor.get(userId);
  const user = deps.users.get(userId);
  if (!record || !user) return { on: false, setup: null, recoveryLeft: 0 };
  if (!record.confirmed) return { on: false, setup: { key: groupSecret(record.secret), link: appLink(record.secret, user.email) }, recoveryLeft: 0 };
  return { on: true, setup: null, recoveryLeft: deps.twoFactor.recoveryLeft(userId) };
}

/** Starts turning it on: a new secret for the app. Nothing changes at sign-in until it is confirmed. */
export function beginTwoFactor(deps: TwoFactorDeps, userId: Id | null): Result<TwoFactorStatus, "forbidden" | "already-on"> {
  if (userId === null || !deps.users.get(userId)) return err("forbidden");
  return deps.transact(() => {
    if (deps.twoFactor.get(userId)?.confirmed) return err("already-on");
    deps.twoFactor.begin(userId, deps.totp.newSecret(), deps.clock());
    return ok(twoFactorStatus(deps, userId));
  });
}

/**
 * Finishes turning it on, once a code from the app proves it works. Answers
 * the recovery codes, which are shown once and never again. The session it
 * was done in counts as passed.
 */
export function confirmTwoFactor(deps: TwoFactorDeps, userId: Id | null, sessionHash: string | null, typed: string): Result<{ readonly recoveryCodes: readonly string[] }, "forbidden" | "not-started" | "already-on" | "code-invalid" | "code-wrong"> {
  if (userId === null || !deps.users.get(userId)) return err("forbidden");
  const code = cleanCode(typed);
  if (!code) return err("code-invalid");
  return deps.transact(() => {
    const record = deps.twoFactor.get(userId);
    if (!record) return err("not-started");
    if (record.confirmed) return err("already-on");
    const step = deps.totp.verify(record.secret, code, nowMs(deps));
    if (step === null) return err("code-wrong");
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => deps.totp.newRecoveryCode());
    deps.twoFactor.confirm(userId, step, codes.map((one) => deps.totp.hash(one)), deps.clock());
    if (sessionHash) deps.twoFactor.markSession(sessionHash, userId, deps.clock());
    recordActivity(deps, { actorId: userId, action: "user.two-factor-on", recordType: "user", recordId: userId });
    return ok({ recoveryCodes: codes.map(showRecoveryCode) });
  });
}

/** Whether this person must pass the second step in this session before anything else. */
export function needsSecondStep(deps: TwoFactorDeps, userId: Id, sessionHash: string | null): boolean {
  const record = deps.twoFactor.get(userId);
  if (!record?.confirmed) return false;
  return sessionHash === null || !deps.twoFactor.sessionPassed(sessionHash, userId);
}

export type SecondStepRefused = "code-invalid" | "code-wrong" | "code-used" | "not-on";

/**
 * The second step at sign-in: a code from the app, or one of the recovery
 * codes. A code is accepted once only. A recovery code used is recorded.
 * The caller limits how often this may be tried.
 */
export function passSecondStep(deps: TwoFactorDeps, userId: Id, sessionHash: string, typed: string): Result<{ readonly usedRecovery: boolean; readonly recoveryLeft: number }, SecondStepRefused> {
  return deps.transact(() => {
    const record = deps.twoFactor.get(userId);
    if (!record?.confirmed) return err("not-on");
    const code = cleanCode(typed);
    if (code) {
      const step = deps.totp.verify(record.secret, code, nowMs(deps));
      if (step === null) return err("code-wrong");
      // A code seen once is never accepted again, even within its 30 seconds.
      if (step <= record.lastStep) return err("code-used");
      deps.twoFactor.setLastStep(userId, step, deps.clock());
      deps.twoFactor.markSession(sessionHash, userId, deps.clock());
      recordActivity(deps, { actorId: userId, action: "user.two-factor-passed", recordType: "user", recordId: userId });
      return ok({ usedRecovery: false, recoveryLeft: deps.twoFactor.recoveryLeft(userId) });
    }
    const recovery = cleanRecoveryCode(typed);
    if (!recovery) return err("code-invalid");
    if (!deps.twoFactor.useRecovery(userId, deps.totp.hash(recovery), deps.clock())) return err("code-wrong");
    deps.twoFactor.markSession(sessionHash, userId, deps.clock());
    const left = deps.twoFactor.recoveryLeft(userId);
    recordActivity(deps, { actorId: userId, action: "user.two-factor-recovery-used", recordType: "user", recordId: userId, context: { left } });
    return ok({ usedRecovery: true, recoveryLeft: left });
  });
}

/** Turns it off for oneself. It takes a current code, so a borrowed session cannot do it. */
export function turnOffTwoFactor(deps: TwoFactorDeps, userId: Id | null, typed: string): Result<true, "forbidden" | "not-on" | "code-invalid" | "code-wrong"> {
  if (userId === null || !deps.users.get(userId)) return err("forbidden");
  return deps.transact(() => {
    const record = deps.twoFactor.get(userId);
    if (!record?.confirmed) {
      // Started and never finished: just forget it.
      if (record) deps.twoFactor.remove(userId);
      return record ? ok(true as const) : err("not-on");
    }
    const code = cleanCode(typed);
    const recovery = code ? null : cleanRecoveryCode(typed);
    if (!code && !recovery) return err("code-invalid");
    const right = code ? deps.totp.verify(record.secret, code, nowMs(deps)) !== null : deps.twoFactor.useRecovery(userId, deps.totp.hash(recovery as string), deps.clock());
    if (!right) return err("code-wrong");
    deps.twoFactor.remove(userId);
    recordActivity(deps, { actorId: userId, action: "user.two-factor-off", recordType: "user", recordId: userId });
    return ok(true as const);
  });
}

/**
 * An admin turns it off for someone who lost their phone and their recovery
 * codes. They sign in with their password alone next time, and can turn it
 * on again. Permission: `user.reset`, the same as making them a new
 * password link. Nobody resets their own this way.
 */
export function resetTwoFactor(deps: TwoFactorDeps, actorId: Id | null, userId: Id): Result<true, "forbidden" | "not-found" | "not-on" | "yourself"> {
  if (!authorize(deps, actorId, "user.reset").ok) return err("forbidden");
  if (actorId === userId) return err("yourself");
  return deps.transact(() => {
    if (!deps.users.get(userId)) return err("not-found");
    if (!deps.twoFactor.get(userId)) return err("not-on");
    deps.twoFactor.remove(userId);
    recordActivity(deps, { actorId, action: "user.two-factor-reset", recordType: "user", recordId: userId });
    return ok(true as const);
  });
}

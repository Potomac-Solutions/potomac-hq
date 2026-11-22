import type { TwoFactorStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

export function sqliteTwoFactorStore(db: Database): TwoFactorStore {
  const get = db.prepare("select user_id, secret, confirmed_at, last_step from user_two_factor where user_id = ?");
  const clearRecovery = db.prepare("delete from two_factor_recovery where user_id = ?");
  const clearSessions = db.prepare("delete from two_factor_session where user_id = ?");
  const clearRecord = db.prepare("delete from user_two_factor where user_id = ?");
  const begin = db.prepare("insert into user_two_factor (user_id, secret, confirmed_at, last_step, created_at, updated_at) values (?, ?, null, 0, ?, ?)");
  const confirm = db.prepare("update user_two_factor set confirmed_at = ?, last_step = ?, updated_at = ? where user_id = ?");
  const addRecovery = db.prepare("insert into two_factor_recovery (user_id, code_hash, used_at) values (?, ?, null)");
  const setLastStep = db.prepare("update user_two_factor set last_step = ?, updated_at = ? where user_id = ? and last_step < ?");
  const useRecovery = db.prepare("update two_factor_recovery set used_at = ? where user_id = ? and code_hash = ? and used_at is null");
  const left = db.prepare("select count(*) as n from two_factor_recovery where user_id = ? and used_at is null");
  const mark = db.prepare("insert into two_factor_session (session_hash, user_id, verified_at) values (?, ?, ?) on conflict (session_hash) do update set user_id = excluded.user_id, verified_at = excluded.verified_at");
  const passed = db.prepare("select 1 from two_factor_session where session_hash = ? and user_id = ?");
  const ruleOn = db.prepare("select 1 from sign_in_rule where key = 'two-factor-for-admins'");
  const ruleSet = db.prepare("insert into sign_in_rule (key, on_since, set_by) values ('two-factor-for-admins', ?, ?) on conflict (key) do nothing");
  const ruleClear = db.prepare("delete from sign_in_rule where key = 'two-factor-for-admins'");
  const wipe = (userId: Id) => {
    clearRecovery.run(userId);
    clearSessions.run(userId);
    clearRecord.run(userId);
  };
  return {
    get(userId) {
      const row = get.get(userId);
      return row ? { userId: row["user_id"] as Id, secret: String(row["secret"]), confirmed: row["confirmed_at"] !== null, lastStep: Number(row["last_step"]) } : null;
    },
    begin(userId, secret, at) {
      wipe(userId);
      begin.run(userId, secret, at, at);
    },
    confirm(userId, step, hashes, at) {
      confirm.run(at, step, at, userId);
      clearRecovery.run(userId);
      for (const hash of hashes) addRecovery.run(userId, hash);
    },
    setLastStep(userId, step, at) {
      setLastStep.run(step, at, userId, step);
    },
    replaceRecovery(userId, hashes) {
      clearRecovery.run(userId);
      for (const hash of hashes) addRecovery.run(userId, hash);
    },
    useRecovery: (userId, hash, at) => Number(useRecovery.run(at, userId, hash).changes) === 1,
    recoveryLeft: (userId) => Number(left.get(userId)?.["n"] ?? 0),
    remove: wipe,
    markSession(sessionHash, userId, at) {
      mark.run(sessionHash, userId, at);
    },
    sessionPassed: (sessionHash, userId) => passed.get(sessionHash, userId) !== undefined,
    requiredForAdmins: () => ruleOn.get() !== undefined,
    setRequiredForAdmins(on, by, at) {
      if (on) ruleSet.run(at, by);
      else ruleClear.run();
    },
  };
}

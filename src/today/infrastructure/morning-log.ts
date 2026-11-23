import type { MorningLog } from "../application/morning.ts";
import type { Database } from "../../shared/adapters.ts";

export function sqliteMorningLog(db: Database): MorningLog {
  const claim = db.prepare("insert into morning_email_sent (user_id, day, sent_at) values (?, ?, ?) on conflict do nothing");
  return {
    claim: (userId, day, at) => Number(claim.run(userId, day, at).changes) === 1,
  };
}

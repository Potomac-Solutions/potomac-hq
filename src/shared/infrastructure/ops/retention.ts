// Enforces docs/retention-policy.md: removes what the policy says HQ should
// stop keeping. It runs each night and from `npm run retention`. HQ does it
// by itself, so the activity event has no actor.
//
// The activity log is never touched here. It is append-only by design, and
// the database refuses to delete from it.
import { recordActivity, type ActivityDeps } from "../../application/record-activity.ts";
import type { Transact } from "../../application/ports.ts";
import type { Database } from "../database.ts";

/** Days a sign-in session or a one-time link is kept after it stopped working. */
export const EXPIRED_SIGN_IN_DAYS = 30;
/** Days an unused invite to HQ is kept. Its link stopped working after seven. */
export const UNUSED_INVITE_DAYS = 30;

export type RetentionResult = { readonly sessions: number; readonly links: number; readonly invites: number };

export function applyRetention(deps: ActivityDeps & { readonly db: Database; readonly transact: Transact }): RetentionResult {
  const now = Temporal.Instant.from(deps.clock());
  const signInCutoff = now.subtract({ hours: 24 * EXPIRED_SIGN_IN_DAYS }).epochMilliseconds;
  const inviteCutoff = now.subtract({ hours: 24 * UNUSED_INVITE_DAYS }).toString();
  // The kit keeps HQ's sessions and links under these names, and the
  // portal's under the same names with "portal:" in front. `until` is when
  // each one stopped working, in milliseconds.
  const expired = deps.db.prepare("delete from kit_document where collection in (?, ?) and cast(json_extract(fields, '$.until') as integer) < ?");
  const invites = deps.db.prepare("delete from user_invite where created_at < ?");
  // A session's two-factor pass goes with the session.
  const passes = deps.db.prepare("delete from two_factor_session where session_hash not in (select key from kit_document where collection = 'staff-sessions')");
  return deps.transact(() => {
    const result = {
      sessions: Number(expired.run("staff-sessions", "portal:staff-sessions", signInCutoff).changes),
      links: Number(expired.run("staff-tokens", "portal:staff-tokens", signInCutoff).changes),
      invites: Number(invites.run(inviteCutoff).changes),
    };
    passes.run();
    if (result.sessions + result.links + result.invites > 0) {
      // Counts only. The log refuses a context that names sessions or links, so these are called what they were.
      recordActivity(deps, { actorId: null, action: "retention.applied", recordType: "retention", recordId: deps.newId(), context: { expiredSignIns: result.sessions, expiredLinks: result.links, staleInvites: result.invites } });
    }
    return result;
  });
}

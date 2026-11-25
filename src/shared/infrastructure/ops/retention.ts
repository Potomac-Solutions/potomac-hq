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
/** Days a refused attempt is kept. */
export const REFUSED_ATTEMPT_DAYS = 90;
/** Days an AI receipt draft nobody used keeps its picture (decision 0012; Mikey, 2026-11-25). */
export const UNUSED_RECEIPT_DAYS = 30;

export type RetentionResult = { readonly sessions: number; readonly links: number; readonly invites: number; readonly receipts: number };

export function applyRetention(deps: ActivityDeps & { readonly db: Database; readonly transact: Transact }): RetentionResult {
  const now = Temporal.Instant.from(deps.clock());
  const signInCutoff = now.subtract({ hours: 24 * EXPIRED_SIGN_IN_DAYS }).epochMilliseconds;
  const inviteCutoff = now.subtract({ hours: 24 * UNUSED_INVITE_DAYS }).toString();
  // The kit keeps HQ's sessions and links under these names, and the
  // portal's under the same names with "portal:" in front. `until` is when
  // each one stopped working, in milliseconds.
  const expired = deps.db.prepare("delete from kit_document where collection in (?, ?) and cast(json_extract(fields, '$.until') as integer) < ?");
  const invites = deps.db.prepare("delete from user_invite where created_at < ?");
  // Refused attempts are kept 90 days (docs/retention-policy.md).
  const refused = deps.db.prepare("delete from refused_attempt where occurred_at < ?");
  const refusedCutoff = now.subtract({ hours: 24 * REFUSED_ATTEMPT_DAYS }).toString();
  // Rate limit windows that have ended.
  const limits = deps.db.prepare("delete from rate_limit where reset_at <= ?");
  // A session's two-factor pass goes with the session.
  const passes = deps.db.prepare("delete from two_factor_session where session_hash not in (select key from kit_document where collection = 'staff-sessions')");
  // An AI receipt draft nobody used or discarded: discarded by HQ, and its picture let go.
  const receipts = deps.db.prepare("update ai_draft set status = 'discarded', decided_at = ?, attachment = null, attachment_name = null where feature = 'receipt' and status = 'waiting' and created_at < ?");
  const receiptCutoff = now.subtract({ hours: 24 * UNUSED_RECEIPT_DAYS }).toString();
  return deps.transact(() => {
    const result = {
      sessions: Number(expired.run("staff-sessions", "portal:staff-sessions", signInCutoff).changes),
      links: Number(expired.run("staff-tokens", "portal:staff-tokens", signInCutoff).changes),
      invites: Number(invites.run(inviteCutoff).changes),
      receipts: Number(receipts.run(now.toString(), receiptCutoff).changes),
    };
    passes.run();
    refused.run(refusedCutoff);
    limits.run(now.epochMilliseconds);
    if (result.sessions + result.links + result.invites + result.receipts > 0) {
      // Counts only. The log refuses a context that names sessions or links, so these are called what they were.
      recordActivity(deps, { actorId: null, action: "retention.applied", recordType: "retention", recordId: deps.newId(), context: { expiredSignIns: result.sessions, expiredLinks: result.links, staleInvites: result.invites, unusedReceipts: result.receipts } });
    }
    return result;
  });
}

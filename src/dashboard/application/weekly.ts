// The weekly owner email (quality of life, 2026-11-25): each Monday morning,
// last week to every active admin. Sent by HQ itself; each email sent is
// recorded, and a run never sends the same week twice to anyone.
import { weeklyEmail, type WeekFacts } from "../domain/weekly.ts";
import type { IdentityUserStore } from "../../identity/index.ts";
import { recordActivity, type ActivityDeps, type Id, type Transact } from "../../shared/index.ts";

export type WeeklyDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  /** Today in the business time zone, YYYY-MM-DD. */
  readonly today: () => string;
  /** Last week's figures, Monday to Sunday. */
  readonly facts: (from: string, to: string, today: string) => WeekFacts;
  /** Whether this person was already sent this week's email. */
  readonly sentFor: (userId: Id, week: string) => boolean;
};

export type WeeklyMail = (message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>;

export async function sendWeeklyEmails(deps: WeeklyDeps, mail: WeeklyMail, options: { readonly publicUrl: string }): Promise<{ readonly sent: number; readonly failed: number }> {
  const today = Temporal.PlainDate.from(deps.today());
  const lastMonday = today.subtract({ days: today.dayOfWeek - 1 + 7 });
  const from = lastMonday.toString();
  const to = lastMonday.add({ days: 6 }).toString();
  const facts = deps.facts(from, to, today.toString());
  let sent = 0;
  let failed = 0;
  for (const user of deps.users.list()) {
    if (user.status !== "active" || !deps.users.rolesOf(user.id).includes("admin") || deps.sentFor(user.id, from)) continue;
    const message = weeklyEmail(facts, user.name, options.publicUrl);
    if (await mail({ to: user.email, ...message })) {
      sent += 1;
      deps.transact(() => recordActivity(deps, { actorId: null, action: "weekly-email.sent", recordType: "user", recordId: user.id, context: { week: from } }));
    } else failed += 1;
  }
  return { sent, failed };
}

// The morning email: each person's Today list, sent once a day to everyone
// who hasn't turned it off. A day with nothing due sends nothing. Each send is
// recorded before it goes, so a restart never sends it twice.
import { todayFor, type TodayDeps, type TodayView } from "./today.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { recordActivity, type ActivityDeps, type Id } from "../../shared/index.ts";

/** The days each person's morning email went. */
export type MorningLog = {
  /** Records it; false when it was already sent that day. */
  claim(userId: Id, day: string, at: string): boolean;
};

export type MorningDeps = TodayDeps & ActivityDeps & { readonly users: IdentityUserStore; readonly morning: MorningLog };
export type MorningMail = (message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>;
export type MorningResult = { readonly sent: number; readonly failed: number; readonly nothingDue: number };

/** The email for one person's list. */
export function morningEmail(view: TodayView, name: string, publicUrl: string): { readonly subject: string; readonly body: string } {
  const base = publicUrl.replace(/\/$/, "");
  const lines = view.items.map((item, index) => {
    const label = item.overdue ? `Overdue ${item.label.toLowerCase()}` : item.label;
    return [`${index + 1}. ${label}: ${item.text}`, item.detail ? `   ${item.detail}` : "", `   ${base}${item.href}`].filter(Boolean).join("\n");
  });
  const first = name.split(" ")[0] || name;
  return {
    subject: `Today, ${view.dayLabel}: ${view.headline.replace(/\.$/, "")}`,
    body: [`Good morning, ${first}.`, "", view.headline, "", ...lines.flatMap((line) => [line, ""]), `Work through it in HQ: ${base}/today`, "", "To stop these, turn off the morning email in Settings."].join("\n"),
  };
}

/** Sends today's list to each active person with the email on. */
export async function sendMorningEmails(deps: MorningDeps, mail: MorningMail, options: { readonly publicUrl: string }): Promise<MorningResult> {
  let sent = 0;
  let failed = 0;
  let nothingDue = 0;
  const day = deps.today();
  for (const user of deps.users.list()) {
    if (user.status !== "active" || !user.email || !deps.users.morningEmailOf(user.id)) continue;
    if (!authorize({ users: deps.users }, user.id, "dashboard.view").ok) continue;
    const view = todayFor(deps, user.id);
    if (view.items.length === 0) {
      nothingDue += 1;
      continue;
    }
    if (!deps.morning.claim(user.id, day, deps.clock())) continue;
    recordActivity(deps, { actorId: null, action: "user.morning-email-sent", recordType: "user", recordId: user.id, context: { day, items: view.items.length } });
    const message = morningEmail(view, user.name, options.publicUrl);
    if (await mail({ to: user.email, ...message })) sent += 1;
    else failed += 1;
  }
  return { sent, failed, nothingDue };
}

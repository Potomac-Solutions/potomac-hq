// System status (quality of life, Mikey 2026-11-25): what HQ is running on
// and whether the things it depends on are working, in one place, so a
// missing backup or a failing email shows up without reading server logs.

export type StatusFacts = {
  readonly version: string;
  /** When this HQ process started, an instant. */
  readonly startedAt: string;
  readonly now: string;
  readonly backupsConfigured: boolean;
  readonly lastBackupAt: string | null;
  readonly lastBackupFailedAt: string | null;
  readonly emailReady: boolean;
  /** Since this process started. */
  readonly email: { readonly sent: number; readonly failed: number; readonly lastProblem: string; readonly lastProblemAt: string | null };
  readonly errors: { readonly count: number; readonly recent: readonly { readonly at: string; readonly message: string }[] };
  readonly ai: { readonly keySet: boolean; readonly featuresOn: number; readonly spent: string; readonly budget: string; readonly percent: number };
  readonly publicUrl: string;
  readonly contactComplete: boolean;
  readonly clientNotices: boolean;
  readonly sitePublisher: boolean;
  readonly database: { readonly bytes: number; readonly migrations: number; readonly lastMigration: string };
};

export type StatusState = "ok" | "warning" | "problem";

export type StatusCheck = {
  readonly key: string;
  readonly label: string;
  readonly state: StatusState;
  readonly stateText: string;
  readonly detail: string;
  readonly href: string;
};

const DAY = 86_400_000;
const age = (now: string, at: string | null): number => (at ? Date.parse(now) - Date.parse(at) : Number.POSITIVE_INFINITY);
const STATE_TEXT: Readonly<Record<StatusState, string>> = { ok: "Working", warning: "Needs a look", problem: "Not working" };

export function statusChecks(facts: StatusFacts, when: (instant: string) => string): readonly StatusCheck[] {
  const check = (key: string, label: string, state: StatusState, detail: string, href = ""): StatusCheck => ({ key, label, state, stateText: STATE_TEXT[state], detail, href });
  const backupAge = age(facts.now, facts.lastBackupAt);
  const failedSince = facts.lastBackupFailedAt !== null && (facts.lastBackupAt === null || facts.lastBackupFailedAt > facts.lastBackupAt);
  const backups = !facts.backupsConfigured
    ? check("backups", "Backups", "problem", "Not set up. Nothing is being backed up.", "/knowledge/operations")
    : failedSince
      ? check("backups", "Backups", "problem", `The last one failed, ${when(facts.lastBackupFailedAt as string)}.`, "/activity?action=backup.failed")
      : backupAge <= 2 * DAY
        ? check("backups", "Backups", "ok", `Last one ${when(facts.lastBackupAt as string)}.`)
        : check("backups", "Backups", "warning", facts.lastBackupAt ? `None since ${when(facts.lastBackupAt)}.` : "Set up, but none has run yet. The first runs tonight.");
  const email = !facts.emailReady
    ? check("email", "Email", "problem", "Not set up: sign-in links, bookings and invoices can't be emailed.", "/knowledge/operations")
    : facts.email.failed > 0 && facts.email.lastProblemAt !== null
      ? check("email", "Email", "warning", `${facts.email.sent} sent and ${facts.email.failed} failed since HQ started. Last failure ${when(facts.email.lastProblemAt)}: ${facts.email.lastProblem}.`)
      : check("email", "Email", "ok", facts.email.sent > 0 ? `${facts.email.sent} sent since HQ started, none failed.` : "Set up. Nothing sent since HQ started.");
  const errors =
    facts.errors.count === 0
      ? check("errors", "Errors", "ok", "None since HQ started.")
      : check("errors", "Errors", facts.errors.count > 20 ? "problem" : "warning", `${facts.errors.count} since HQ started. The newest are listed below.`);
  const ai = !facts.ai.keySet
    ? check("ai", "AI", "warning", "No API key: AI features and the assistant are off.", "/settings/ai")
    : check("ai", "AI", facts.ai.percent >= 100 ? "problem" : facts.ai.percent >= 80 ? "warning" : "ok", `${facts.ai.featuresOn} feature${facts.ai.featuresOn === 1 ? "" : "s"} on. ${facts.ai.spent} of ${facts.ai.budget} spent this month (${facts.ai.percent}%).`, "/settings/ai");
  const settings: string[] = [];
  if (!facts.publicUrl) settings.push("HQ_PUBLIC_URL isn't set, so links in email and passkeys can't name HQ's address");
  if (!facts.contactComplete) settings.push("HQ_CONTACT_* is incomplete, so clients don't see all of how to reach you");
  if (!facts.clientNotices) settings.push("HQ_CLIENT_NOTICES is off, so clients aren't emailed when something waits for them");
  if (!facts.sitePublisher) settings.push("GitHub isn't connected, so sites can't be set up or published");
  const config = settings.length === 0 ? check("settings", "Server settings", "ok", "Everything HQ reads is set.") : check("settings", "Server settings", "warning", settings.join(". ") + ".", "/knowledge/operations");
  return [backups, email, errors, ai, config];
}

/** A database's size in words: "3.4 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

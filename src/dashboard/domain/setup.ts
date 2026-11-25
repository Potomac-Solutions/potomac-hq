// Get HQ ready (decision 0015, section 3): what's left to set up, worked out
// from HQ's real state. Nothing here is ticked by hand: a line is done when
// the thing it asks for is true.

export type SetupFacts = {
  /** Whether nightly backups are configured on the server. */
  readonly backupsConfigured: boolean;
  /** When the last backup finished, or null. An instant. */
  readonly lastBackupAt: string | null;
  /** Now, an instant. */
  readonly now: string;
  readonly emailReady: boolean;
  readonly contact: { readonly phone: string; readonly email: string; readonly address: string };
  readonly twoFactorOn: boolean;
  readonly aiKeySet: boolean;
  readonly aiFeaturesOn: number;
  readonly bookingHours: number;
  /** Clients that aren't demos. */
  readonly realClients: number;
  /** Active HQ users, the viewer included. */
  readonly activeUsers: number;
};

export type SetupItem = {
  readonly key: string;
  readonly label: string;
  /** Why it matters, in a sentence. */
  readonly why: string;
  readonly done: boolean;
  /** Where it's done. */
  readonly href: string;
  readonly action: string;
};

export type Setup = {
  readonly items: readonly SetupItem[];
  readonly doneCount: number;
  readonly total: number;
  /** Every line done: the panel goes away. */
  readonly finished: boolean;
  /** Three quarters or more done: the panel starts folded. */
  readonly mostlyDone: boolean;
};

const DAY_MS = 86_400_000;

/** A backup counts when one finished in the last two days. */
function recentBackup(facts: SetupFacts): boolean {
  if (!facts.lastBackupAt) return false;
  const age = Date.parse(facts.now) - Date.parse(facts.lastBackupAt);
  return Number.isFinite(age) && age <= 2 * DAY_MS;
}

export function setupChecklist(facts: SetupFacts): Setup {
  const contactDone = Boolean(facts.contact.phone && facts.contact.email && facts.contact.address);
  const items: SetupItem[] = [
    {
      key: "backups",
      label: "Nightly backups",
      why: facts.backupsConfigured ? "Backups are set up. This ticks itself once the first one has run tonight." : "Nothing is backed up yet. Set the HQ_BACKUP_* settings on the server and keep the private key offline.",
      done: recentBackup(facts),
      href: "/knowledge/operations",
      action: "How to set up backups",
    },
    {
      key: "email",
      label: "Email",
      why: "HQ can't send sign-in links, booking confirmations or invoices without it. Set HQ_BREVO_API_KEY and HQ_EMAIL_FROM.",
      done: facts.emailReady,
      href: "/knowledge/operations",
      action: "How to set up email",
    },
    {
      key: "contact",
      label: "How clients reach you",
      why: "The portal and every email show your phone, email and mailing address. The newsletter won't send without the address.",
      done: contactDone,
      href: "/knowledge/operations",
      action: "Set HQ_CONTACT_*",
    },
    {
      key: "two-factor",
      label: "Two-factor sign-in",
      why: "An admin account can see everything. A code or passkey keeps it yours.",
      done: facts.twoFactorOn,
      href: "/settings#two-factor",
      action: "Turn it on",
    },
    {
      key: "hours",
      label: "Hours people can book",
      why: "Booking links and the website's free call offer only the hours you set.",
      done: facts.bookingHours > 0,
      href: "/calls/hours",
      action: "Set your hours",
    },
    {
      key: "clients",
      label: "Your clients",
      why: "Paste your clients in once, and everything else (projects, invoices, the portal) hangs off them.",
      done: facts.realClients > 0,
      href: "/clients/import",
      action: "Import clients",
    },
    {
      key: "team",
      label: "Your co-founder",
      why: "Invite anyone who works in HQ with you, with the role that fits.",
      done: facts.activeUsers > 1,
      href: "/people",
      action: "Invite someone",
    },
    {
      key: "ai",
      label: "AI and the assistant",
      why: facts.aiKeySet ? "The key is set. Turn on the features you want, the assistant included." : "Set HQ_ANTHROPIC_API_KEY on the server, then turn on the features you want.",
      done: facts.aiKeySet && facts.aiFeaturesOn > 0,
      href: "/settings/ai",
      action: "Open AI settings",
    },
  ];
  const doneCount = items.filter((item) => item.done).length;
  return { items, doneCount, total: items.length, finished: doneCount === items.length, mostlyDone: doneCount * 4 >= items.length * 3 };
}

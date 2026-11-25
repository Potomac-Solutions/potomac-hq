// Every page in HQ, named once (decision 0015): its hub, its address, the
// words people use for it and who may open it. The sidebar, search and the
// assistant all read this list, so a new page is added here and nowhere else.
//
// A gate is a word the app answers for the viewer: "perm:<permission>",
// "ai:<feature>|<feature>" (any of them on), "ai:manage" or "ai:drafts".
// No gate: anyone signed in. The pages themselves still check.

export const HUBS = [
  { key: "home", label: "Home" },
  { key: "today", label: "Today" },
  { key: "clients", label: "Clients" },
  { key: "work", label: "Work" },
  { key: "sites", label: "Sites" },
  { key: "money", label: "Money" },
  { key: "growth", label: "Growth" },
  { key: "company", label: "Company" },
] as const;
export type HubKey = (typeof HUBS)[number]["key"];

export type Place = {
  readonly key: string;
  readonly label: string;
  readonly hub: HubKey;
  readonly href: string;
  /** Addresses this page answers for, beyond its own: "/opportunities" for the pipeline. */
  readonly also?: readonly string[];
  /** Other words for it, lower case. */
  readonly words: readonly string[];
  /** What it's for, in a few words, for search and the assistant. */
  readonly what: string;
  readonly gate?: string;
  /** Found by search and the assistant, but not listed in the sidebar. */
  readonly hidden?: boolean;
};

export const PLACES: readonly Place[] = [
  { key: "home", label: "Home", hub: "home", href: "/", words: ["dashboard", "assistant", "chat", "start", "setup"], what: "The assistant, setup and the company at a glance" },

  { key: "today", label: "Today", hub: "today", href: "/today", words: ["agenda", "due", "follow-ups", "calls to make"], what: "What's due today: follow-ups, calls, to-dos" },
  { key: "todos", label: "My work", hub: "today", href: "/todos", words: ["to-dos", "todos", "tasks", "mine", "assigned"], what: "Your to-dos and tasks" },
  { key: "drafts", label: "AI drafts", hub: "today", href: "/drafts", gate: "ai:drafts", words: ["ai", "drafts", "claude", "waiting"], what: "Drafts AI wrote, waiting for you" },
  { key: "notices", label: "Notices", hub: "today", href: "/notices", hidden: true, words: ["notifications", "bell", "alerts", "reminders"], what: "Your notices" },
  { key: "add", label: "Quick add", hub: "today", href: "/add", hidden: true, gate: "perm:task.edit", words: ["new task", "new to-do", "add task", "add todo"], what: "Add a task or to-do in plain words" },

  { key: "pipeline", label: "Pipeline", hub: "clients", href: "/pipeline", also: ["/opportunities"], words: ["deals", "opportunities", "leads", "sales", "stages"], what: "Deals by stage" },
  { key: "clients", label: "Clients", hub: "clients", href: "/clients", words: ["customers", "contacts", "companies", "crm", "portal invite"], what: "Clients and their contacts" },
  { key: "import", label: "Import clients", hub: "clients", href: "/clients/import", hidden: true, gate: "perm:client.edit", words: ["import", "paste", "add clients", "bulk"], what: "Add clients from a pasted list" },
  { key: "proposals", label: "Proposals", hub: "clients", href: "/proposals", gate: "perm:proposal.view", words: ["quotes", "estimates", "agreements", "esign", "sign"], what: "Proposals, quotes and signed agreements" },
  { key: "calls", label: "Calls", hub: "clients", href: "/calls", also: ["/phone", "/get-ready", "/calls/invites"], gate: "perm:call.respond", words: ["booking", "booked calls", "phone", "consultation", "schedule", "booking links"], what: "Booked calls, booking links and call requests" },
  { key: "hours", label: "Calendar hours", hub: "clients", href: "/calls/hours", hidden: true, gate: "perm:call.respond", words: ["hours", "availability", "open hours", "when i'm free", "calendar"], what: "The hours people can book you" },
  { key: "availability", label: "Availability", hub: "clients", href: "/calls/availability", hidden: true, gate: "perm:call.respond", words: ["availability", "timeful", "calendly", "paint times", "grid"], what: "Paint your availability, or fill it from Timeful or Calendly" },
  { key: "guides", label: "Call guides", hub: "clients", href: "/call-guides", hidden: true, gate: "perm:call.respond", words: ["questions", "script", "guide"], what: "The questions each kind of call works through" },
  { key: "monthly-reports", label: "Monthly reports", hub: "clients", href: "/monthly-reports", gate: "perm:client-report.send", words: ["client reports", "monthly", "plan clients"], what: "Monthly reports to plan clients" },

  { key: "projects", label: "Projects", hub: "work", href: "/projects", also: ["/tasks", "/imports"], words: ["jobs", "phases", "milestones", "deliverables"], what: "Projects, phases and milestones" },
  { key: "board", label: "Board", hub: "work", href: "/board", words: ["kanban", "drag", "columns"], what: "Every task on a board" },
  { key: "timeline", label: "Timeline", hub: "work", href: "/timeline", words: ["gantt", "schedule", "dates"], what: "Tasks on a timeline" },
  { key: "work", label: "All work", hub: "work", href: "/work", words: ["filters", "table", "saved filters", "list"], what: "Every task in a table, with saved filters" },
  { key: "labels", label: "Labels", hub: "work", href: "/labels", words: ["tags", "colors"], what: "Task labels" },
  { key: "time", label: "Time", hub: "work", href: "/time", gate: "perm:time.log", words: ["timer", "hours", "timesheet", "billable", "time tracking"], what: "Your hours and the timer" },
  { key: "calendar-feed", label: "Calendar feed", hub: "work", href: "/calendar-feed", hidden: true, words: ["ical", "calendar", "subscribe", "google calendar"], what: "Your tasks in your own calendar app" },

  { key: "sites", label: "Sites", hub: "sites", href: "/sites", words: ["monitoring", "uptime", "down", "certificates", "ssl"], what: "Clients' sites, watched for outages" },
  { key: "websites", label: "Site content", hub: "sites", href: "/websites", words: ["website content", "photos", "pages", "text"], what: "Content for clients' websites" },
  { key: "builder", label: "Site builder", hub: "sites", href: "/builder", gate: "perm:site.build", words: ["build a site", "ai website", "design", "generate"], what: "Build clients' sites with Claude" },
  { key: "builder-settings", label: "Site builder model and cap", hub: "sites", href: "/builder/settings", hidden: true, gate: "perm:site.build", words: ["budget", "cap", "spend", "model"], what: "The site builder's model and the monthly AI cap" },
  { key: "landing-pages", label: "Landing pages", hub: "sites", href: "/landing-pages", words: ["free page", "free landing page", "rounds"], what: "Free landing pages and their rounds of changes" },
  { key: "automations", label: "Automations", hub: "sites", href: "/automations", words: ["n8n", "workflows", "zaps"], what: "n8n automations run for clients" },

  { key: "money", label: "Money", hub: "money", href: "/money", also: ["/invoices"], gate: "perm:finance.view", words: ["invoices", "payments", "billing", "expenses", "recurring", "deposit"], what: "Invoices, payments and expenses" },
  { key: "profit", label: "Profit and loss", hub: "money", href: "/money/profit", hidden: true, gate: "perm:finance.view", words: ["p&l", "profit", "loss", "taxes", "income"], what: "Profit and loss by month" },
  { key: "renewals", label: "Renewals", hub: "sites", href: "/renewals", words: ["domains", "hosting", "renew", "expiring"], what: "Domains and plans coming up for renewal" },
  { key: "reports", label: "Reports", hub: "money", href: "/reports", gate: "perm:report.view", words: ["budget", "health", "estimate vs actual", "analytics"], what: "Pipeline, project health and budget reports" },
  { key: "lead-sources", label: "Lead sources", hub: "money", href: "/reports/lead-sources", hidden: true, gate: "perm:report.view", words: ["where leads come from", "utm", "sources", "marketing"], what: "Where leads came from" },

  { key: "newsletter", label: "Newsletter", hub: "growth", href: "/newsletter", gate: "perm:newsletter.manage", words: ["notes from the river", "email list", "subscribers", "issues"], what: "Notes from the river, the newsletter" },
  { key: "social", label: "Social media", hub: "growth", href: "/social", gate: "perm:social.view", words: ["facebook", "instagram", "linkedin", "posts", "calendar"], what: "Clients' social media plans and posts" },
  { key: "marketing", label: "Marketing", hub: "growth", href: "/marketing", gate: "ai:case-study|social-posts", words: ["case studies", "social posts", "ai drafts"], what: "AI case study and post drafts" },
  { key: "referrals", label: "Referral links", hub: "growth", href: "/referrals", gate: "perm:referral.manage", words: ["qr", "short links", "referral credit"], what: "Referral links and QR codes" },
  { key: "reviews", label: "Reviews", hub: "growth", href: "/reviews", gate: "perm:review.manage", words: ["testimonials", "case studies", "showcase"], what: "Reviews and case studies" },
  { key: "demos", label: "Demos", hub: "growth", href: "/demos", gate: "perm:demo.manage", words: ["lab", "demo apps", "prospects"], what: "The Lab's demos and who opened them" },
  { key: "our-website", label: "Our website", hub: "growth", href: "/our-website", gate: "perm:public-site.view", words: ["potomac.solutions", "maintenance", "coming soon", "banner", "prices"], what: "Potomac's own website: mode, banner, details" },

  { key: "knowledge", label: "Knowledge", hub: "company", href: "/knowledge", words: ["docs", "decisions", "articles", "wiki", "handbook"], what: "The knowledge base and decision log" },
  { key: "ask", label: "Ask HQ", hub: "company", href: "/ask", gate: "ai:ask", words: ["question", "ai"], what: "Questions answered from the knowledge base" },
  { key: "people", label: "People", hub: "company", href: "/people", gate: "perm:user.view", words: ["users", "team", "invite", "roles", "jayanti", "accounts"], what: "Who has an HQ account, and their roles" },
  { key: "activity", label: "Audit history", hub: "company", href: "/activity", gate: "perm:activity.view-all", words: ["activity", "log", "audit", "history", "who did"], what: "Everything everyone did" },
  { key: "webhooks", label: "Webhooks", hub: "company", href: "/webhooks", gate: "perm:webhook.manage", words: ["n8n", "integrations", "events"], what: "Webhooks to other tools" },
  { key: "ai-settings", label: "AI model and budget", hub: "company", href: "/settings/ai", gate: "ai:manage", words: ["ai", "claude", "budget", "model", "features", "assistant"], what: "Which AI features are on, the model and the budget" },
  { key: "settings", label: "Settings", hub: "company", href: "/settings", hidden: true, words: ["theme", "dark mode", "password", "two-factor", "2fa", "passkey", "morning email", "account"], what: "Your account: theme, password, two-factor, morning email" },
];

/** Whether an address is a page's: its own or one it answers for, exactly or below it. */
const under = (path: string, start: string): boolean => (start === "/" ? path === "/" : path === start || path.startsWith(start + "/"));

/** The place an address belongs to: the one whose address matches it longest. */
export function placeAt(places: readonly Place[], path: string): Place | null {
  let best: Place | null = null;
  let length = -1;
  for (const place of places) {
    for (const start of [place.href, ...(place.also ?? [])]) {
      if (under(path, start) && start.length > length) {
        best = place;
        length = start.length;
      }
    }
  }
  return best;
}

export type NavLink = { readonly label: string; readonly href: string; readonly current: boolean };
export type NavHub = {
  readonly key: HubKey;
  readonly label: string;
  readonly open: boolean;
  readonly current: boolean;
  /** A hub that is one page of the same name (Home): shown as that link alone. */
  readonly single: boolean;
  readonly links: readonly NavLink[];
};

/**
 * The sidebar for a viewer: each hub with the pages they may open, the hub
 * holding this address open. `extra` adds links after a place (pinned
 * filters after All work); `currentHref` overrides which link is current
 * when the address alone can't say (a pinned filter's search).
 */
export function navHubs(
  allowed: readonly Place[],
  path: string,
  options: { readonly extra?: Readonly<Record<string, readonly NavLink[]>>; readonly currentHref?: string | null } = {},
): readonly NavHub[] {
  const found = placeAt(allowed, path);
  // On a page the sidebar doesn't list (Calendar hours), the listed page it
  // sits under (Calls) is the current one.
  const here = found?.hidden ? (allowed.find((place) => !place.hidden && place.hub === found.hub && found.href.startsWith(place.href + "/")) ?? found) : found;
  const currentHub = here?.hub ?? null;
  return HUBS.flatMap((hub) => {
    const places = allowed.filter((place) => place.hub === hub.key && !place.hidden);
    if (places.length === 0) return [];
    const links = places.flatMap((place) => {
      const current = options.currentHref !== undefined && options.currentHref !== null ? false : here?.key === place.key;
      return [{ label: place.label, href: place.href, current }, ...(options.extra?.[place.key] ?? [])];
    });
    const marked = options.currentHref ? links.map((link) => ({ ...link, current: link.href === options.currentHref })) : links;
    const single = marked.length === 1 && marked[0]?.label === hub.label;
    return [{ key: hub.key, label: hub.label, open: hub.key === currentHub, current: hub.key === currentHub, single, links: marked }];
  });
}

/** Lower case words, without punctuation at the ends. */
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9&]+|[^a-z0-9&]+$/g, ""))
    .filter((word) => word.length > 0);

const STOP = new Set(["a", "an", "the", "to", "of", "my", "i", "me", "where", "is", "are", "how", "do", "can", "page", "for", "in", "on", "go", "open", "find", "show", "set", "up", "and", "with", "what", "it", "please"]);

/**
 * Pages that match what was typed, best first: a page's name scores most,
 * then its other words, then what it's for. Words like "where is" and "go
 * to" are ignored, so "where do I set my hours" finds Calendar hours.
 */
export function matchPlaces(places: readonly Place[], raw: string, limit = 5): readonly Place[] {
  const asked = wordsOf(raw).filter((word) => !STOP.has(word));
  if (asked.length === 0) return [];
  const phrase = asked.join(" ");
  const scored = places.map((place, index) => {
    const label = place.label.toLowerCase();
    const labelWords = wordsOf(place.label);
    const other = place.words.flatMap(wordsOf);
    const what = wordsOf(place.what);
    let score = 0;
    if (label === phrase) score += 100;
    else if (label.startsWith(phrase)) score += 40;
    if (place.words.includes(phrase)) score += 30;
    for (const word of asked) {
      const starts = (list: readonly string[]) => list.some((one) => one.startsWith(word) || (word.length > 3 && word.startsWith(one) && one.length > 3));
      if (starts(labelWords)) score += 10;
      else if (starts(other)) score += 6;
      else if (starts(what)) score += 2;
    }
    return { place, score, index };
  });
  return scored
    .filter((one) => one.score >= 6)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((one) => one.place);
}

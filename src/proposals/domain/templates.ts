// One starting point per service Potomac offers at launch
// (docs/workflow.md, "Services at launch"). A template fills a new draft.
// Every word and number can be changed before the proposal is sent. The list
// prices here are the defaults from the workflow document: the price on each
// deal is whatever its own proposal says.
import type { LineInput } from "./estimate.ts";
import type { ProposalInput } from "./proposal.ts";

type Template = {
  readonly label: string;
  readonly pricing: string;
  readonly scope: string;
  readonly assumptions: string;
  readonly exclusions: string;
  readonly deliverables: string;
  readonly lines: readonly LineInput[];
};

const line = (item: string, kind: "hours" | "quantity", quantity: string, rate: string): LineInput => ({ item, kind, quantity, rate });

const ASSUMES_CONTENT = "- You send the words, photos and logo the work needs.\n- One person on your side gives feedback and approval.";

export const TEMPLATES: Readonly<Record<string, Template>> = {
  consulting: {
    label: "Consulting",
    pricing: "hourly",
    scope: "Web and online consulting by call. The first 30 minutes are free.",
    assumptions: "- Calls are booked ahead.\n- Time is billed in quarter hours after the free half hour.",
    exclusions: "- Building or changing a website or application. That is quoted separately.",
    deliverables: "- A written summary after each call.",
    lines: [line("Consulting", "hours", "1", "75")],
  },
  "landing-page": {
    label: "Free landing page",
    pricing: "free",
    scope: "One landing page, hosted at your-name.potomac.solutions.",
    assumptions: `${ASSUMES_CONTENT}\n- Up to four rounds of changes, then a final approval.`,
    exclusions: "- More pages, a blog or a shop.\n- Changes after the fourth round. Those are $50 an hour, or quoted for larger work.",
    deliverables: "- The published landing page.\n- A zip of the site, if you ask for one.",
    lines: [line("Landing page", "quantity", "1", "0")],
  },
  "domain-management": {
    label: "Domain management",
    pricing: "yearly",
    scope: "Your domain name registered, renewed and managed by Potomac Solutions.",
    assumptions: "- The domain is registered in your name.\n- The registrar's yearly price can change. You pay what it costs.",
    exclusions: "- Email hosting.",
    deliverables: "- The domain pointed at your site and renewed on time.",
    lines: [line("Domain registration, at cost", "quantity", "1", "15"), line("Management fee", "quantity", "1", "10")],
  },
  website: {
    label: "Multi-page website",
    pricing: "monthly",
    scope: "A multi-page website, with support and updates for as long as the plan runs.",
    assumptions: `${ASSUMES_CONTENT}\n- Updates are requested by message and done in turn.`,
    exclusions: "- Custom application features. Those are quoted separately.\n- Paid advertising.",
    deliverables: "- The website, published on your domain.\n- Ongoing updates and support.",
    lines: [line("Website plan", "quantity", "1", "50")],
  },
  blog: {
    label: "Blog platform",
    pricing: "monthly",
    scope: "A blog added to your Potomac website and kept current.",
    assumptions: "- You have a Potomac website plan.\n- You write the posts, or send notes to turn into posts.",
    exclusions: "- Writing posts from scratch.",
    deliverables: "- The blog, set up on your site.\n- Posts published as you send them.",
    lines: [line("Blog add-on", "quantity", "1", "10")],
  },
  "social-media": {
    label: "Social media marketing",
    pricing: "monthly",
    scope: "Content created for your Facebook, Instagram and LinkedIn pages.",
    assumptions: "- You give access to the pages.\n- You approve posts before they go out.",
    exclusions: "- Paid ads and the ad budget.\n- Answering comments and messages.",
    deliverables: "- Posts for each page, every month.",
    lines: [line("Social media plan", "quantity", "1", "50")],
  },
  application: {
    label: "Application development",
    pricing: "fixed",
    scope: "A custom application, built to the description below.",
    assumptions: `${ASSUMES_CONTENT}\n- Work starts when the deposit of one third is paid.\n- The balance is due before launch.`,
    exclusions: "- Features not listed under Scope. Those are quoted as changes.\n- Third-party fees, such as payment processing.",
    deliverables: "- The working application, launched.\n- A walkthrough of how to use it.",
    lines: [line("Design", "hours", "8", "75"), line("Build", "hours", "20", "75"), line("Testing and launch", "hours", "4", "75")],
  },
  automation: {
    label: "Automations",
    pricing: "fixed",
    scope: "Workflow automations built on n8n, to the description below.",
    assumptions: "- You give access to the accounts the automation connects.\n- Work starts when the deposit of one third is paid.",
    exclusions: "- Fees charged by the services the automation connects to.",
    deliverables: "- The automation, running.\n- A short note on what it does and how to pause it.",
    lines: [line("Automation build", "hours", "6", "75")],
  },
};

const BLANK: Template = { label: "Blank", pricing: "fixed", scope: "", assumptions: "", exclusions: "", deliverables: "", lines: [] };

export const TEMPLATE_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  ...Object.entries(TEMPLATES).map(([value, template]) => ({ value, label: template.label })),
  { value: "blank", label: "Blank" },
];

/** A draft's starting content. An unknown key gives a blank proposal. */
export function fromTemplate(key: string | null | undefined, title: string): ProposalInput {
  const template = (key !== null && key !== undefined && Object.hasOwn(TEMPLATES, key) ? TEMPLATES[key] : undefined) ?? BLANK;
  return { title, pricing: template.pricing, scope: template.scope, assumptions: template.assumptions, exclusions: template.exclusions, deliverables: template.deliverables, lines: template.lines };
}

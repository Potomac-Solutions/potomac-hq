// A client's free landing page (decision 0013, section 3): its address on
// potomac.solutions, where it stands, and the rounds of changes the client
// has asked for. Four rounds are free, then the final approval; changes after
// that are paid work.
import type { Id } from "../../shared/domain/id.ts";
import { requiredText } from "../../shared/domain/fields.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const FREE_ROUNDS = 4;
/** What changes cost once the free rounds are used, as the website says it. */
export const PAID_CHANGES = "$50 an hour";
export const DOMAIN = "potomac.solutions";

export const PAGE_STATUSES = ["requested", "building", "in-review", "approved", "live", "handed-over"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];
export const PAGE_STATUS_LABELS: Readonly<Record<PageStatus, string>> = {
  requested: "Asked for",
  building: "Being built",
  "in-review": "Ready for you to look at",
  approved: "Approved",
  live: "Live",
  "handed-over": "Handed over",
};
export const isPageStatus = (value: string): value is PageStatus => (PAGE_STATUSES as readonly string[]).includes(value);

/** Once approved, the free page is done: anything more is paid. */
export const isApproved = (status: PageStatus): boolean => status === "approved" || status === "live" || status === "handed-over";

export type FreePage = {
  readonly id: Id;
  readonly organizationId: Id;
  /** The part before .potomac.solutions. Null until Potomac chooses it, or when it's on the client's own domain. */
  readonly subdomain: string | null;
  /** The client's own domain, like betterdaystowing.com, when the page lives there instead. */
  readonly ownDomain: string | null;
  readonly status: PageStatus;
  /** Where its code lives, to hand it over as a zip: owner/name, and a branch. */
  readonly repo: { readonly owner: string; readonly name: string; readonly branch: string } | null;
  readonly approvedAt: string | null;
};

export type Round = {
  readonly id: Id;
  readonly freePageId: Id;
  readonly number: number;
  readonly text: string;
  /** False for a round after the free ones, or after approval: paid work for Potomac to price. */
  readonly free: boolean;
  readonly from: "client" | "staff";
  readonly doneAt: string | null;
  readonly createdAt: string;
};

// Names that are, or may become, Potomac's own.
const RESERVED = new Set(["www", "hq", "mail", "email", "api", "app", "admin", "portal", "blog", "staging", "test", "dev", "status", "help", "support", "docs", "studio", "lab", "shop", "store"]);

export type SubdomainError = "subdomain-invalid" | "subdomain-reserved";

/** A name typed as "Moats Hardware", "moats-hardware" or "moats-hardware.potomac.solutions". */
export function cleanSubdomain(typed: string): Result<string | null, SubdomainError> {
  const text = typed.trim().toLowerCase().replace(/\.potomac\.solutions\.?$/, "").replace(/^https?:\/\//, "").replace(/[\s_]+/g, "-");
  if (text === "") return ok(null);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(text) || text.includes("--")) return err("subdomain-invalid");
  return RESERVED.has(text) ? err("subdomain-reserved") : ok(text);
}

export type DomainError = "domain-invalid" | "domain-ours";

/** A client's own domain, typed as "BetterDaysTowing.com", "https://www.betterdaystowing.com/" or the like. Empty for none. */
export function cleanDomain(typed: string): Result<string | null, DomainError> {
  const text = typed.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (text === "") return ok(null);
  if (text.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(text)) return err("domain-invalid");
  // A name on potomac.solutions is chosen as the address, not typed as a domain of its own.
  return text === DOMAIN || text.endsWith(`.${DOMAIN}`) ? err("domain-ours") : ok(text);
}

/** Where the page lives: its own domain, or its name on potomac.solutions. "" until chosen. */
export const addressOf = (page: Pick<FreePage, "subdomain" | "ownDomain"> | null): string => (page?.ownDomain ? `https://${page.ownDomain}` : page?.subdomain ? `https://${page.subdomain}.${DOMAIN}` : "");

/** "owner/name", or "owner/name#branch". Empty for none. */
export function cleanRepo(typed: string): Result<FreePage["repo"], "repo-invalid"> {
  const text = typed.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (text === "") return ok(null);
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:#([A-Za-z0-9._/-]{1,100}))?$/.exec(text);
  if (!match || match[2] === "." || match[2] === ".." || (match[3] ?? "").includes("..")) return err("repo-invalid");
  return ok({ owner: match[1] as string, name: match[2] as string, branch: match[3] ?? "main" });
}

export const repoText = (repo: FreePage["repo"]): string => (repo ? `${repo.owner}/${repo.name}${repo.branch === "main" ? "" : `#${repo.branch}`}` : "");

export type RoundError = "text-missing" | "text-too-long";

/** What a round asks for. */
export function roundText(typed: string): Result<string, RoundError> {
  const text = requiredText(typed.replace(/\r\n/g, "\n"), 4000);
  return text.ok ? ok(text.value) : err(text.error === "missing" ? "text-missing" : "text-too-long");
}

/** The next round: its number, and whether it's one of the free ones. */
export function nextRound(page: { readonly status: PageStatus }, rounds: readonly Pick<Round, "free">[]): { readonly number: number; readonly free: boolean } {
  const used = rounds.filter((one) => one.free).length;
  return { number: rounds.length + 1, free: used < FREE_ROUNDS && !isApproved(page.status) };
}

/** "2 of 4 free rounds used". */
export function roundsUsedText(rounds: readonly Pick<Round, "free">[]): string {
  const used = rounds.filter((one) => one.free).length;
  return `${used} of ${FREE_ROUNDS} free rounds used`;
}

/** Whether the client may still ask, or approve. A page only asked for has nothing to look at yet. */
export const canAskForChanges = (status: PageStatus): boolean => status !== "requested";
export const canApprove = (status: PageStatus): boolean => status === "building" || status === "in-review";

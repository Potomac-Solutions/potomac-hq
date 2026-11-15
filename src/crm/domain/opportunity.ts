// One possible piece of work for one client (docs/data-model.md, and the
// stages in docs/workflow.md).
import type { Id } from "../../shared/domain/id.ts";
import type { Money } from "../../shared/domain/money.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { calendarDate, optionalText, requiredText } from "./fields.ts";

export const SERVICES = ["consulting", "landing-page", "domain-management", "website", "blog", "social-media", "application", "automation"] as const;
export type Service = (typeof SERVICES)[number];

export const STAGES = ["new", "consult-booked", "consulted", "quoted", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

/** The stages an opportunity moves forward through, in order. `lost` can be reached from any open stage. */
const FORWARD: readonly Stage[] = ["new", "consult-booked", "consulted", "quoted", "won"];

export const PRICINGS = ["free", "hourly", "fixed", "monthly", "yearly"] as const;
export type Pricing = (typeof PRICINGS)[number];

export const LEAD_SOURCES = ["word-of-mouth", "phone", "email", "website", "social", "referral", "other"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export type Opportunity = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly contactId: Id | null;
  readonly ownerId: Id;
  readonly title: string;
  readonly service: Service | null;
  readonly stage: Stage;
  readonly pricing: Pricing | null;
  /** The quoted price: per hour, per period or in total, by `pricing`. */
  readonly value: Money | null;
  readonly leadSource: LeadSource;
  /** YYYY-MM-DD in the business time zone. */
  readonly followUpOn: string | null;
  readonly summary: string;
  readonly lostReason: string | null;
  readonly closedAt: string | null;
};

const isOne = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value);
export const isService = (value: string): value is Service => isOne(SERVICES, value);
export const isStage = (value: string): value is Stage => isOne(STAGES, value);
export const isPricing = (value: string): value is Pricing => isOne(PRICINGS, value);
export const isLeadSource = (value: string): value is LeadSource => isOne(LEAD_SOURCES, value);

export const isOpen = (opportunity: Opportunity): boolean => opportunity.stage !== "won" && opportunity.stage !== "lost";

export type OpportunityInput = {
  readonly title: string;
  readonly leadSource: string;
  readonly service?: string | null;
  readonly contactId?: Id | null;
  readonly summary?: string | null;
};

export type OpportunityError =
  | "title-missing"
  | "title-too-long"
  | "invalid-lead-source"
  | "invalid-service"
  | "summary-too-long";

export function newOpportunity(
  ids: { readonly id: Id; readonly organizationId: Id; readonly ownerId: Id },
  input: OpportunityInput,
): Result<Opportunity, OpportunityError> {
  const title = requiredText(input.title, 200);
  if (!title.ok) return err(title.error === "missing" ? "title-missing" : "title-too-long");
  if (!isLeadSource(input.leadSource)) return err("invalid-lead-source");
  const service = (input.service ?? "").trim();
  if (service !== "" && !isService(service)) return err("invalid-service");
  const summary = optionalText(input.summary, 5000);
  if (!summary.ok) return err("summary-too-long");
  return ok({
    ...ids,
    contactId: input.contactId ?? null,
    title: title.value,
    service: service === "" ? null : (service as Service),
    stage: "new",
    pricing: null,
    value: null,
    leadSource: input.leadSource,
    followUpOn: null,
    summary: summary.value ?? "",
    lostReason: null,
    closedAt: null,
  });
}

export type ValueError = "closed" | "invalid-pricing" | "free-must-be-zero" | "value-must-be-positive";

/** Sets the pricing shape and the quoted price. Only while the opportunity is open. */
export function setValue(opportunity: Opportunity, pricing: string, value: Money): Result<Opportunity, ValueError> {
  if (!isOpen(opportunity)) return err("closed");
  if (!isPricing(pricing)) return err("invalid-pricing");
  if (pricing === "free" && value.minor !== 0) return err("free-must-be-zero");
  if (pricing !== "free" && value.minor <= 0) return err("value-must-be-positive");
  return ok({ ...opportunity, pricing, value });
}

export type StageError =
  | "closed"
  | "invalid-stage"
  | "unchanged"
  | "not-the-next-stage"
  | "service-required"
  | "price-required"
  | "lost-reason-required"
  | "lost-reason-too-long";

/**
 * Moves an opportunity on.
 *
 * - Forward one stage at a time: new, consult-booked, consulted, quoted, won.
 * - A landing page may go from consulted straight to won (it is free, so there is no quote).
 * - Any open stage may move to lost, with a reason.
 * - Won and lost are final. A deal that comes back is a new opportunity.
 * - From consulted on, the service must be known. Quoted and won need a price.
 */
export function moveStage(
  opportunity: Opportunity,
  to: string,
  options: { readonly at: string; readonly lostReason?: string | null },
): Result<Opportunity, StageError> {
  if (!isOpen(opportunity)) return err("closed");
  if (!isStage(to)) return err("invalid-stage");
  if (to === opportunity.stage) return err("unchanged");

  if (to === "lost") {
    const reason = requiredText(options.lostReason, 1000);
    if (!reason.ok) return err(reason.error === "missing" ? "lost-reason-required" : "lost-reason-too-long");
    return ok({ ...opportunity, stage: "lost", lostReason: reason.value, closedAt: options.at });
  }

  const next = FORWARD[FORWARD.indexOf(opportunity.stage) + 1];
  const landingPageSkip = opportunity.service === "landing-page" && opportunity.stage === "consulted" && to === "won";
  if (to !== next && !landingPageSkip) return err("not-the-next-stage");
  if (FORWARD.indexOf(to) >= FORWARD.indexOf("consulted") && opportunity.service === null) return err("service-required");
  if ((to === "quoted" || to === "won") && (opportunity.pricing === null || opportunity.value === null)) return err("price-required");

  return ok({ ...opportunity, stage: to, closedAt: to === "won" ? options.at : null });
}

/** The stage that comes after this one, if any. */
export function nextStage(opportunity: Opportunity): Stage | null {
  if (!isOpen(opportunity)) return null;
  return FORWARD[FORWARD.indexOf(opportunity.stage) + 1] ?? null;
}

/** Sets or clears the follow-up date. Only while the opportunity is open. */
export function setFollowUp(opportunity: Opportunity, on: string | null): Result<Opportunity, "closed" | "invalid-date"> {
  if (!isOpen(opportunity)) return err("closed");
  if (on === null || on.trim() === "") return ok({ ...opportunity, followUpOn: null });
  const date = calendarDate(on.trim());
  if (!date.ok) return date;
  return ok({ ...opportunity, followUpOn: date.value });
}

/** Due when open and the follow-up date is today or earlier. */
export function isFollowUpDue(opportunity: Opportunity, today: string): boolean {
  return isOpen(opportunity) && opportunity.followUpOn !== null && opportunity.followUpOn <= today;
}

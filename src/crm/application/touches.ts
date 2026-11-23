// Logging calls, emails, texts and meetings with a client, and the timeline
// they make. Logging one can set the opportunity's next follow-up in the same
// step: "left a voicemail, try again Thursday".
import { newTouch, OUTCOME_LABELS, TOUCH_KIND_LABELS, touchLabel, type Touch, type TouchError, type TouchInput } from "../domain/touch.ts";
import { setFollowUp } from "../domain/opportunity.ts";
import { COLD_AFTER_DAYS, quietDays } from "../domain/cold.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import type { CrmDeps } from "./commands.ts";
import type { TouchStore } from "./ports.ts";

export type TouchDeps = CrmDeps & { readonly touches: TouchStore; readonly formatWhen: (instant: string) => string; readonly today: () => string; readonly timeZone: string };
type Refused = "forbidden" | "not-found";
const allowed = (deps: CrmDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

export type LogTouchInput = TouchInput & { readonly contactId?: string | null; readonly followUpOn?: string | null };

/**
 * Logs a touch at a client, or on one of its opportunities. A follow-up day,
 * on an open opportunity, is set in the same transaction. Permission:
 * `contact.edit`, and `opportunity.set-follow-up` to set the day.
 */
export function logTouch(deps: TouchDeps, actorId: Id | null, where: { readonly clientId: Id } | { readonly opportunityId: Id }, input: LogTouchInput): Result<Touch, Refused | TouchError | "contact-not-at-client" | "invalid-date" | "closed"> {
  if (!allowed(deps, actorId, "contact.edit")) return err("forbidden");
  const followUp = (input.followUpOn ?? "").trim();
  if (followUp && !allowed(deps, actorId, "opportunity.set-follow-up")) return err("forbidden");
  return deps.transact(() => {
    const opportunity = "opportunityId" in where ? deps.opportunities.get(where.opportunityId) : null;
    if ("opportunityId" in where && !opportunity) return err("not-found");
    const organizationId = opportunity ? opportunity.organizationId : (where as { clientId: Id }).clientId;
    if (!deps.clients.get(organizationId)) return err("not-found");
    const contactId = (input.contactId ?? "").trim() || null;
    if (contactId && deps.contacts.get(contactId as Id)?.organizationId !== organizationId) return err("contact-not-at-client");
    const touch = newTouch({ id: deps.newId(), organizationId, opportunityId: opportunity?.id ?? null, contactId: contactId as Id | null, userId: actorId, happenedAt: deps.clock() }, input);
    if (!touch.ok) return touch;
    if (followUp) {
      if (!opportunity) return err("not-found");
      const changed = setFollowUp(opportunity, followUp);
      if (!changed.ok) return changed;
      deps.opportunities.update(changed.value, deps.clock());
      recordActivity(deps, { actorId, action: "opportunity.follow-up-set", recordType: "opportunity", recordId: opportunity.id, context: { on: changed.value.followUpOn } });
    }
    deps.touches.insert(touch.value, deps.clock());
    recordActivity(deps, { actorId, action: "touch.logged", recordType: "touch", recordId: touch.value.id, context: { clientId: organizationId, kind: touch.value.kind, ...(touch.value.outcome ? { outcome: touch.value.outcome } : {}) } });
    return ok(touch.value);
  });
}

export type TouchLine = { readonly id: string; readonly label: string; readonly when: string; readonly whenIso: string; readonly who: string; readonly withWhom: string; readonly note: string; readonly opportunityId: string; readonly opportunityTitle: string };

export type TouchesView = {
  readonly items: readonly TouchLine[];
  readonly canLog: boolean;
  readonly canFollowUp: boolean;
  readonly kinds: readonly { readonly value: string; readonly label: string }[];
  readonly outcomes: readonly { readonly value: string; readonly label: string }[];
  readonly contacts: readonly { readonly value: string; readonly label: string }[];
  readonly last: string;
  /** On an opportunity going cold, why; otherwise empty. */
  readonly cold: string;
};

function view(deps: TouchDeps, actorId: Id, organizationId: Id, touches: readonly Touch[], showOpportunity: boolean): TouchesView {
  const contacts = deps.contacts.listFor(organizationId);
  const names = new Map(contacts.map((one) => [one.id, one.name]));
  const titles = new Map(deps.opportunities.listFor(organizationId).map((one) => [one.id, one.title]));
  const newest = touches[0];
  return {
    items: touches.map((one) => ({
      id: one.id,
      label: touchLabel(one),
      when: deps.formatWhen(one.happenedAt),
      whenIso: one.happenedAt,
      who: deps.users.get(one.userId)?.name ?? "Someone",
      withWhom: one.contactId ? (names.get(one.contactId) ?? "") : "",
      note: one.note,
      opportunityId: one.opportunityId ?? "",
      opportunityTitle: showOpportunity && one.opportunityId ? (titles.get(one.opportunityId) ?? "") : "",
    })),
    canLog: allowed(deps, actorId, "contact.edit"),
    canFollowUp: allowed(deps, actorId, "opportunity.set-follow-up"),
    kinds: Object.entries(TOUCH_KIND_LABELS).map(([value, label]) => ({ value, label })),
    outcomes: Object.entries(OUTCOME_LABELS).map(([value, label]) => ({ value, label })),
    contacts: contacts.map((one) => ({ value: one.id, label: one.name })),
    last: newest ? `Last touch ${deps.formatWhen(newest.happenedAt)}: ${touchLabel(newest).toLowerCase()}` : "No touches logged yet",
    cold: "",
  };
}

/** A client's timeline. Permission: `client.view`. */
export function clientTouches(deps: TouchDeps, actorId: Id | null, organizationId: Id): Result<TouchesView, "forbidden"> {
  if (!allowed(deps, actorId, "client.view")) return err("forbidden");
  return ok(view(deps, actorId, organizationId, deps.touches.listForClient(organizationId, 50), true));
}

/** An opportunity's timeline. Permission: `opportunity.view`. */
export function opportunityTouches(deps: TouchDeps, actorId: Id | null, opportunityId: Id): Result<TouchesView, Refused> {
  if (!allowed(deps, actorId, "opportunity.view")) return err("forbidden");
  const opportunity = deps.opportunities.get(opportunityId);
  if (!opportunity) return err("not-found");
  const cold = goingCold(deps, actorId).find((one) => one.id === opportunityId);
  return ok({ ...view(deps, actorId, opportunity.organizationId, deps.touches.listForOpportunity(opportunityId, 50), false), cold: cold ? `Going cold: no contact in ${cold.days} days and no follow-up set. Log a call or set a follow-up.` : "" });
}

export type ColdLine = { readonly id: string; readonly title: string; readonly clientName: string; readonly organizationId: string; readonly days: number; readonly lastText: string };

/**
 * Open opportunities going cold: no follow-up set and no contact with the
 * client for two weeks, the quietest first. Permission: `opportunity.view`;
 * empty without it.
 */
export function goingCold(deps: TouchDeps, actorId: Id | null): readonly ColdLine[] {
  if (!allowed(deps, actorId, "opportunity.view")) return [];
  const today = deps.today();
  const last = deps.touches.lastActiveByOpportunity();
  const lines: ColdLine[] = [];
  for (const one of deps.opportunities.listOpen()) {
    const at = last.get(one.id);
    if (!at) continue;
    const days = quietDays(one, Temporal.Instant.from(at).toZonedDateTimeISO(deps.timeZone).toPlainDate().toString(), today, COLD_AFTER_DAYS);
    if (days === null) continue;
    lines.push({ id: one.id, title: one.title, clientName: one.clientName, organizationId: one.organizationId, days, lastText: `No contact in ${days} days and no follow-up set` });
  }
  return lines.sort((a, b) => b.days - a.days);
}

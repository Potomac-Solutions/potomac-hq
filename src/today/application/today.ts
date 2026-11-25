// Today: one list, in order, of what wants doing today across HQ. Booked
// calls, what clients are waiting on, sites that are down, follow-ups due,
// to-dos, project deadlines, social media posts, opportunities going cold and renewals this week. Each part shows only to
// someone who may see it, by the permission its own module checks. The same
// list is the morning email.
import { headline, orderAgenda, AGENDA_LABELS, type AgendaItem, type AgendaKind } from "../domain/agenda.ts";
import { nextCalls, type BookingDeps } from "../../booking/index.ts";
import { followUpsDue, goingCold, type TouchDeps } from "../../crm/index.ts";
import { sitesNeedingAttention, type MonitorDeps } from "../../monitor/index.ts";
import { staffWaiting, type PortalDeps } from "../../portal/index.ts";
import { upcomingDeadlines, type ProjectsDeps } from "../../projects/index.ts";
import { renewalsComingUp, type RenewalsDeps } from "../../renewals/index.ts";
import { socialToDo, type SocialDeps } from "../../social/index.ts";
import { daysUntil } from "../../shared/index.ts";
import { roundsWaiting, type FreePagesDeps } from "../../free-pages/index.ts";
import { reportsToSend, type ReportsDeps } from "../../client-reports/index.ts";
import { automationsNeedingAttention, type AutomationsDeps } from "../../automations/index.ts";
import { reviewsWaiting, type ShowcaseDeps } from "../../showcase/index.ts";
import type { Id } from "../../shared/index.ts";
import { todosDoneSince, todosDueFor, type TodoLine, type TodosDeps } from "../../todos/index.ts";

export type TodayDeps = {
  /** The CRM, with its call log, for follow-ups and opportunities going cold. */
  readonly crm: TouchDeps;
  readonly todos: TodosDeps;
  readonly booking: BookingDeps;
  readonly portal: PortalDeps;
  readonly projects: ProjectsDeps;
  readonly renewals: RenewalsDeps;
  readonly social: SocialDeps;
  readonly monitor: MonitorDeps;
  /** Free landing pages: rounds of changes asked for (decision 0013, section 3). */
  readonly freePages: FreePagesDeps;
  /** Monthly reports drafted and not yet sent (decision 0013, section 4). */
  readonly clientReports: ReportsDeps;
  /** n8n automations that failed or didn't run on time (decision 0013, section 5). */
  readonly automations: AutomationsDeps;
  /** Reviews waiting to be published or kept back (decision 0013, section 6). */
  readonly showcase: ShowcaseDeps;
  readonly timeZone: string;
  readonly today: () => string;
  readonly clock: () => string;
};

export type TodayLine = AgendaItem & { readonly label: string };

export type TodayView = {
  readonly items: readonly TodayLine[];
  readonly headline: string;
  readonly overdue: number;
  /** To-dos ticked off today. */
  readonly done: readonly TodoLine[];
  readonly day: string;
  readonly dayLabel: string;
};

const RENEWAL_DAYS = 7;

/** Everything due today for this person, in the order to work it. */
export function todayFor(deps: TodayDeps, actorId: Id | null): TodayView {
  const today = deps.today();
  const items: AgendaItem[] = [];
  const add = (kind: AgendaKind, rest: Omit<AgendaItem, "kind" | "todoId"> & { readonly todoId?: string }) => items.push({ kind, todoId: "", ...rest });
  const dayOf = (instant: string) => Temporal.Instant.from(instant).toZonedDateTimeISO(deps.timeZone).toPlainDate().toString();

  for (const call of nextCalls(deps.booking, actorId, 50) ?? []) {
    if (dayOf(call.whenIso) !== today) continue;
    add("call", { key: `call-${call.id}`, text: `${call.who}, ${call.when}`, detail: [call.kindLabel, call.topic, call.phone].filter(Boolean).join(" · "), href: call.crmHref || "/calls", action: "Open", overdue: false, at: call.whenIso });
  }
  for (const one of staffWaiting(deps.portal, actorId).items) add("waiting", { key: `waiting-${one.key}`, text: one.text, detail: one.detail, href: one.href, action: one.action, overdue: false, at: one.since });
  for (const one of reviewsWaiting(deps.showcase, actorId)) add("waiting", { key: `review-${one.id}`, text: `A review from ${one.clientName} to publish`, detail: `${one.stars} ${one.who}`, href: "/reviews", action: "Open", overdue: false, at: "" });
  for (const one of roundsWaiting(deps.freePages, actorId)) add("waiting", { key: `round-${one.key}`, text: one.text, detail: one.detail, href: one.href, action: "Open", overdue: false, at: one.since });
  for (const site of sitesNeedingAttention(deps.monitor, actorId)) {
    if (site.state !== "down") continue;
    add("site", { key: `site-${site.id}`, text: `${site.host} is down`, detail: `${site.clientName}. ${site.lastResult}`, href: "/sites", action: "Open", overdue: false, at: "" });
  }
  for (const one of automationsNeedingAttention(deps.automations, actorId)) add("site", { key: `automation-${one.id}`, text: `${one.name}: ${one.state === "failed" ? "failed" : "didn’t run on time"}`, detail: [one.clientName, one.lastMessage].filter(Boolean).join(". "), href: `/clients/${one.organizationId}#automations`, action: "Open", overdue: false, at: "" });
  const followUps = followUpsDue(deps.crm, actorId, today);
  for (const one of followUps.ok ? followUps.value.items : []) {
    add("follow-up", { key: `follow-up-${one.id}`, text: `${one.title}`, detail: `${one.clientName} · ${one.followUpText}`, href: `/opportunities/${one.id}#touches`, action: "Log a call", overdue: one.overdue, at: one.followUpOn });
  }
  for (const one of todosDueFor(deps.todos, actorId)) {
    add("todo", { key: `todo-${one.id}`, text: one.title, detail: [one.when, one.clientName, one.opportunityTitle].filter(Boolean).join(" · "), href: one.opportunityId ? `/opportunities/${one.opportunityId}#todos` : one.organizationId ? `/clients/${one.organizationId}#todos` : "/todos", action: "Open", overdue: one.state === "overdue", at: one.dueOn, todoId: one.id });
  }
  const deadlines = upcomingDeadlines(deps.projects, actorId, 0);
  for (const one of deadlines.ok ? deadlines.value.items : []) {
    add("deadline", { key: `deadline-${one.key}`, text: `${one.kind}: ${one.title}`, detail: `${one.projectName} · ${one.dueText}`, href: one.href, action: "Open", overdue: one.overdue, at: one.dueOn });
  }
  // Social media (decision 0011): a client's asks are something they're waiting on; approved posts due are to put up.
  for (const one of socialToDo(deps.social, actorId)) {
    const href = `/clients/${one.organizationId}/social?month=${one.day.slice(0, 7)}#post-${one.id}`;
    if (one.kind === "changes") add("waiting", { key: `social-${one.id}`, text: one.text, detail: one.detail, href, action: "Change it", overdue: false, at: one.day });
    else add("social", { key: `social-${one.id}`, text: one.text, detail: one.detail, href, action: "Put it up", overdue: one.overdue, at: one.day });
  }
  for (const one of goingCold(deps.crm, actorId)) {
    add("cold", { key: `cold-${one.id}`, text: one.title, detail: `${one.clientName} · ${one.lastText}`, href: `/opportunities/${one.id}#touches`, action: "Log a call", overdue: false, at: String(1000 - one.days).padStart(4, "0") });
  }
  for (const one of reportsToSend(deps.clientReports, actorId)) add("report", { key: `report-${one.id}`, text: one.text, detail: one.detail, href: `/monthly-reports/${one.id}`, action: "Open", overdue: false, at: one.month });
  for (const one of renewalsComingUp(deps.renewals, actorId)) {
    const days = daysUntil(one.renewsOn, today);
    if (days !== null && days > RENEWAL_DAYS) continue;
    add("renewal", { key: `renewal-${one.id}`, text: `${one.name} renews`, detail: `${one.clientName} · ${one.when}${one.autoRenews ? " · renews by itself" : ""}`, href: `/clients/${one.organizationId}#renewals`, action: "Open", overdue: one.state === "overdue", at: one.renewsOn });
  }

  const ordered = orderAgenda(items);
  const startOfDay = Temporal.PlainDate.from(today).toZonedDateTime(deps.timeZone).toInstant().toString();
  return {
    items: ordered.map((one) => ({ ...one, label: AGENDA_LABELS[one.kind] })),
    headline: headline(ordered),
    overdue: ordered.filter((one) => one.overdue).length,
    done: todosDoneSince(deps.todos, actorId, startOfDay),
    day: today,
    dayLabel: Temporal.PlainDate.from(today).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" }),
  };
}

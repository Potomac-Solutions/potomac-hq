// Booking links. Booking a free call needs a portal account, unless Potomac
// has given the person a link: with it they choose a time and say who they
// are and what the call is about, with no account. Afterwards they are
// offered an account, and need not take it.
import { checkBooker, type Booking, type BookerInput } from "../domain/booking.ts";
import { checkLinkBooker, LINK_STATE_LABELS, linkState, newLink, type BookingLink, type LinkError, type LinkInput, type LinkState } from "../domain/link.ts";
import { authorize } from "../../identity/index.ts";
import { err, ok, recordActivity, type Id, type Result } from "../../shared/index.ts";
import { bookCall, openTimes, type BookError, type BookingDeps, type OpenTimesView } from "./booking.ts";
import type { BookingLinkStore } from "./ports.ts";

export type LinkDeps = BookingDeps & { readonly links: BookingLinkStore };

const allowed = (deps: BookingDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;
const todayOf = (deps: BookingDeps) => Temporal.Instant.from(deps.clock()).toZonedDateTimeISO(deps.timeZone).toPlainDate().toString();
/** The address a link is opened at. */
export const linkPath = (token: string): string => `/book/with/${token}`;

/** Makes a booking link for someone. Permission: `booking.manage`. */
export function createBookingLink(deps: LinkDeps, actorId: Id | null, input: LinkInput): Result<BookingLink, "forbidden" | LinkError> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const made = newLink({ id: deps.newId(), token: deps.tokens.newToken(), createdBy: actorId }, input, todayOf(deps), deps.clock());
  if (!made.ok) return made;
  return deps.transact(() => {
    deps.links.add(made.value);
    // The label says who it is for. The token is the key, and is never written here.
    recordActivity(deps, { actorId, action: "booking-link.created", recordType: "booking-link", recordId: made.value.id, context: { label: made.value.label, oneTime: made.value.oneTime, ...(made.value.lastDay ? { lastDay: made.value.lastDay } : {}) } });
    return ok(made.value);
  });
}

/** Stops a link working. Calls already booked with it stay. Permission: `booking.manage`. */
export function withdrawBookingLink(deps: LinkDeps, actorId: Id | null, id: Id): Result<true, "forbidden" | "not-found"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.links.get(id);
    if (!found || !deps.links.withdraw(id, deps.clock())) return err("not-found");
    recordActivity(deps, { actorId, action: "booking-link.withdrawn", recordType: "booking-link", recordId: id, context: { label: found.label } });
    return ok(true as const);
  });
}

export type LinkLine = {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly state: LinkState;
  readonly stateLabel: string;
  /** "One call" or "Any number of calls", how many so far, and until when. */
  readonly terms: string;
};

/** The booking links, newest first: open ones, and the last few that stopped. Permission: `booking.manage`. */
export function bookingLinks(deps: LinkDeps, actorId: Id | null): Result<readonly LinkLine[], "forbidden"> {
  if (!allowed(deps, actorId, "booking.manage")) return err("forbidden");
  const today = todayOf(deps);
  const lines = deps.links.list().map((link) => {
    const state = linkState(link, today);
    const until = link.lastDay ? `until ${Temporal.PlainDate.from(link.lastDay).toLocaleString("en-US", { month: "short", day: "numeric" })}` : "no end date";
    return { id: link.id, label: link.label, path: linkPath(link.token), state, stateLabel: LINK_STATE_LABELS[state], terms: `${link.oneTime ? "One call" : "Any number of calls"}, ${until} · ${link.uses} booked` };
  });
  return ok([...lines.filter((one) => one.state === "open"), ...lines.filter((one) => one.state !== "open").slice(0, 5)]);
}

export type LinkPageView = { readonly state: LinkState | "unknown"; readonly times: OpenTimesView };

/** What someone opening a link sees: whether it still works, and the open times. */
export async function bookingLinkPage(deps: LinkDeps, token: string): Promise<LinkPageView> {
  const link = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? deps.links.byToken(token) : null;
  const state = link ? linkState(link, todayOf(deps)) : "unknown";
  return { state, times: state === "open" ? await openTimes(deps, "link") : { open: false, callMinutes: 0, days: [], calendarFailed: false } };
}

export type LinkBookError = BookError | "link-unknown" | "link-ended" | "topic-missing" | "phone-missing" | "business-too-long";

/**
 * Books a call with a link: no account needed. It asks for a name, an
 * email, a phone number and what the call is about; the business is
 * optional. Answers the call and its own private link, for moving or
 * cancelling it. A one-time link is spent by the booking, not by a try.
 */
export async function bookWithLink(deps: LinkDeps, token: string, input: BookerInput & { readonly business?: string | null }, start: string): Promise<Result<{ readonly booking: Booking; readonly manageToken: string }, LinkBookError>> {
  const link = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? deps.links.byToken(token) : null;
  if (!link) return err("link-unknown");
  if (linkState(link, todayOf(deps)) !== "open") return err("link-ended");
  const who = checkBooker(input);
  if (!who.ok) return who;
  const more = checkLinkBooker(input);
  if (!more.ok) return more;
  // Claimed first, so a one-time link can't book two calls at once; given back if no call comes of it.
  if (!deps.links.claim(link.id)) return err("link-ended");
  const booked = await bookCall(deps, { kind: "public", linkId: link.id, business: more.value.business, name: input.name, email: input.email, phone: input.phone ?? null, topic: input.topic ?? null }, start).catch(() => null);
  if (!booked?.ok || !booked.value.manageToken) {
    deps.links.release(link.id);
    return booked && !booked.ok ? booked : err("calendar-failed");
  }
  return ok({ booking: booked.value.booking, manageToken: booked.value.manageToken });
}

import type { Booking } from "../domain/booking.ts";
import type { ScheduleInvite } from "../domain/invite.ts";
import type { Busy, DayRange, HoursRange } from "../domain/hours.ts";
import type { Id } from "../../shared/index.ts";

export type BookingSettings = {
  /** Whose calendar the calls go on. */
  readonly hostId: Id;
  readonly callMinutes: number;
  readonly gapMinutes: number;
  readonly noticeHours: number;
  readonly daysAhead: number;
  readonly portalOpen: boolean;
  readonly publicOpen: boolean;
  readonly hours: readonly HoursRange[];
};

export type ClosedDay = { readonly day: string; readonly note: string };

export type BookingStore = {
  /** Null until someone sets the hours the first time. */
  settings(): BookingSettings | null;
  saveSettings(settings: BookingSettings, at: string): void;
  closedDays(fromDay: string): readonly ClosedDay[];
  /** Replaces the usual week's stretches, keeping the other settings. */
  saveWeek(hours: readonly HoursRange[], at: string): void;
  /** Days from this one painted differently from the usual week, with their stretches. */
  paintedDates(fromDay: string): Readonly<Record<string, readonly DayRange[]>>;
  /** Paints a day differently; null puts it back to the usual week. */
  paintDate(day: string, ranges: readonly DayRange[] | null, at: string): void;
  closeDay(day: ClosedDay): void;
  openDay(day: string): boolean;
  /** Booked calls that overlap from..to, earliest first. */
  booked(from: string, to: string): readonly Booking[];
  /** Calls of either status starting from..to, earliest first. */
  between(from: string, to: string): readonly Booking[];
  forOrganization(organizationId: Id, from: string): readonly Booking[];
  get(id: Id): Booking | null;
  byManageHash(hash: string): Booking | null;
  add(booking: Booking, manageHash: string | null): void;
  save(booking: Booking): void;
  /**
   * Booked calls starting from..to with no reminder yet, that were booked
   * at least 20 hours before they start: a call booked for this afternoon
   * needs no reminder.
   */
  dueReminders(from: string, to: string): readonly Booking[];
  markReminded(id: Id, at: string): void;
  setCrm(id: Id, clientId: Id, opportunityId: Id): void;
};

/** Times already taken in another calendar, such as Google Calendar. None until one is connected. */
export type BusyCalendar = {
  readonly name: string;
  busy(from: string, to: string): Promise<readonly Busy[]>;
};

/** The private link for a booking made from the booking page. */
export type ManageTokens = { newToken(): string; hash(token: string): string };

export type ScheduleInviteStore = {
  insert(invite: ScheduleInvite, at: string): void;
  update(invite: ScheduleInvite, at: string): void;
  get(id: Id): ScheduleInvite | null;
  /** Open invites, oldest first. */
  listOpen(): readonly ScheduleInvite[];
  /** A client's invites, newest first. */
  listFor(organizationId: Id): readonly ScheduleInvite[];
  /** The half hours the invitee said they could do, replacing any before. */
  setCells(inviteId: Id, starts: readonly string[]): void;
  cells(inviteId: Id): ReadonlySet<string>;
};

/** People in the client portal, as booking needs them: who an invite is for. */
export type ClientPeople = {
  get(clientUserId: Id): { readonly organizationId: Id; readonly name: string; readonly email: string; readonly active: boolean } | null;
};

export type OutsideAnswer = { readonly status: number; readonly text: string };
export type OutsideError = "address-invalid" | "address-private" | "unreachable" | "too-large";
/**
 * Reads an address someone typed, on the public internet: https only, never
 * an address inside the server's own network, with a size and a time limit.
 */
export type OutsideFetch = (url: string, headers?: Readonly<Record<string, string>>) => Promise<{ readonly ok: true; readonly value: OutsideAnswer } | { readonly ok: false; readonly error: OutsideError }>;

/** A calendar's private address, read for busy times. */
export type CalendarLink = {
  readonly id: Id;
  readonly label: string;
  readonly url: string;
  readonly addedBy: Id;
  readonly addedAt: string;
  readonly checkedAt: string | null;
  /** Why it couldn't be read last time; empty when it could. */
  readonly problem: string;
};

export type CalendarLinkStore = {
  list(): readonly CalendarLink[];
  add(link: CalendarLink): void;
  remove(id: Id): boolean;
  checked(id: Id, at: string, problem: string): void;
};

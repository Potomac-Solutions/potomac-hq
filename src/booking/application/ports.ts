import type { Booking } from "../domain/booking.ts";
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

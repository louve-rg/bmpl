/// Answering "is this terminal open at this instant, and if not, when does
/// it next open" from configured data - never invented, never a fabricated
/// schedule. BMPL-186/service-schedule.ts's own header names this card
/// (BMPL-177) and says to reuse ITS resolution shape rather than writing a
/// second one - this file does: exception wins, else the weekly pattern,
/// else a documented default, the identical order resolveScheduleStatus
/// already uses. The weekly rows here carry open/close TIMES instead of a
/// status, because a counter's hours answer "is someone there between two
/// clock times" rather than "does a scheduled departure run today" - see
/// hub_opening_days' own migration comment for the full reasoning.
///
/// Framework-free by design (root CLAUDE.md sec 2): the API and any future
/// browser-side "is this hub open" preview must agree, and a rule stated
/// twice is a rule that eventually disagrees with itself (the same reason
/// belize-time.ts exists at all, per BMPL-197).
///
/// NO CONSUMER YET (BMPL-262 scope): this file is the pure resolver only.
/// Nothing in apps/api calls it this round - that is deliberate, not an
/// oversight, so there is nothing yet to wire to the wrong place.

import { belizeCalendarDate, belizeCalendarDateKey, belizeWeekday, startOfBelizeDay, toBelizeLocal } from './belize-time';

export const HUB_HOURS_EXCEPTION_STATUSES = ['CLOSED', 'MODIFIED'] as const;
export type HubHoursExceptionStatus = (typeof HUB_HOURS_EXCEPTION_STATUSES)[number];

export const HUB_HOURS_EXCEPTION_STATUS_LABELS: Record<HubHoursExceptionStatus, string> = {
  CLOSED: 'Closed',
  MODIFIED: 'Modified hours',
};

export interface WeeklyOpeningHours {
  /**
   * 0=Sunday .. 6=Saturday, matching VendorOpeningHours/RouteOperatingDay -
   * resolved against Belize LOCAL time (`belizeWeekday`), not JS
   * `Date#getUTCDay()`.
   */
  dayOfWeek: number;
  /** "HH:MM", Belize local. Both null when `isClosed`. */
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export interface HoursException {
  /** A calendar date - the time-of-day component is ignored by design. */
  date: Date;
  status: HubHoursExceptionStatus;
  /** Only meaningful when `status` is MODIFIED. */
  openTime?: string | null;
  closeTime?: string | null;
  reason?: string | null;
}

export interface HoursResolution {
  /** Whether the instant checked falls inside an open window. */
  isOpen: boolean;
  /** The effective window for that instant's calendar date, if any is
   *  configured. Both null when unconstrained (open all day, nothing
   *  recorded to compare against) or when closed all day. */
  openTime: string | null;
  closeTime: string | null;
  /** True when a date-specific exception decided this, not the weekly default. */
  isException: boolean;
  reason: string | null;
}

export interface NextOpenWindow {
  /** Belize calendar date the window falls on (UTC-midnight normalized, the
   *  same representation `belizeCalendarDate` and a `@db.Date` column use). */
  date: Date;
  /** Null on both when the date is unconstrained (open all day, no specific
   *  window configured) rather than a configured window with real times. */
  openTime: string | null;
  closeTime: string | null;
}

/** "HH:MM" -> minutes since midnight. */
function parseMinutes(hhmm: string): number {
  const parts = hhmm.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return h * 60 + m;
}

/** Minutes since Belize-local midnight for a real instant. */
function minutesOfDayBelize(instant: Date): number {
  const local = toBelizeLocal(instant);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

interface EffectiveHours {
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  isException: boolean;
  reason: string | null;
}

/**
 * The effective hours for one calendar date - exception wins, else the
 * weekly pattern for that date's Belize weekday, else UNCONSTRAINED.
 *
 * The unconstrained default (no weekly row AND no exception for this date)
 * is deliberate and load-bearing: it is the same "no closure recorded"
 * assumption service-schedule.ts's resolveScheduleStatus already makes for
 * an unconfigured route (its own default is OPERATING) - so configuring
 * nothing changes nothing, and a hub that has never had its hours entered
 * behaves exactly as it does today. DO NOT change this to a restrictive
 * default (closed) - that would make the migration that creates
 * hub_opening_days/hub_hours_exceptions a behaviour change for every
 * existing hub on the day it ships, which it must not be.
 */
function effectiveHoursForDate(
  date: Date,
  weeklyPattern: readonly WeeklyOpeningHours[],
  exceptions: readonly HoursException[],
): EffectiveHours {
  const target = belizeCalendarDateKey(date);
  // HoursException.date is already a pure calendar date (Prisma @db.Date,
  // UTC-midnight normalized by the caller that stored it) - format it
  // directly, with no Belize shift, exactly as resolveScheduleStatus does
  // for RouteScheduleException.date, or it would land on the wrong day.
  const exception = exceptions.find((e) => e.date.toISOString().slice(0, 10) === target);
  if (exception) {
    if (exception.status === 'CLOSED') {
      return { openTime: null, closeTime: null, isClosed: true, isException: true, reason: exception.reason ?? null };
    }
    return {
      openTime: exception.openTime ?? null,
      closeTime: exception.closeTime ?? null,
      isClosed: false,
      isException: true,
      reason: exception.reason ?? null,
    };
  }
  const weekday = belizeWeekday(date);
  const day = weeklyPattern.find((d) => d.dayOfWeek === weekday);
  if (day) {
    return {
      openTime: day.isClosed ? null : day.openTime,
      closeTime: day.isClosed ? null : day.closeTime,
      isClosed: day.isClosed,
      isException: false,
      reason: null,
    };
  }
  return { openTime: null, closeTime: null, isClosed: false, isException: false, reason: null };
}

/**
 * Whether a hub (or, by the same shape, a vendor) is open at `instant`.
 *
 * Overnight windows (closeTime numerically before openTime, e.g. a counter
 * open 20:00-02:00) are NOT specially handled - same-day comparison only,
 * matching VendorOpeningHours' existing "HH:MM" pair, which has never
 * carried wraparound semantics either. A misconfigured overnight row would
 * resolve as never open; that is a pre-existing limitation of the reused
 * shape, not a new one introduced here.
 */
export function resolveHoursStatus(
  instant: Date,
  weeklyPattern: readonly WeeklyOpeningHours[],
  exceptions: readonly HoursException[],
): HoursResolution {
  const eff = effectiveHoursForDate(instant, weeklyPattern, exceptions);
  if (eff.isClosed) {
    return { isOpen: false, openTime: null, closeTime: null, isException: eff.isException, reason: eff.reason };
  }
  if (eff.openTime == null || eff.closeTime == null) {
    // Unconstrained for this date: nothing configured to compare the
    // instant against, so it is open with no window to report.
    return { isOpen: true, openTime: null, closeTime: null, isException: eff.isException, reason: eff.reason };
  }
  const minutes = minutesOfDayBelize(instant);
  const open = parseMinutes(eff.openTime);
  const close = parseMinutes(eff.closeTime);
  // Inclusive open, exclusive close: open AT openTime, no longer open AT
  // closeTime - the instant closeTime is when the counter locks up, not the
  // last minute it still accepts a handoff.
  const isOpen = minutes >= open && minutes < close;
  return { isOpen, openTime: eff.openTime, closeTime: eff.closeTime, isException: eff.isException, reason: eff.reason };
}

/** Default search horizon for `nextOpenWindow` - see its own doc comment. */
export const DEFAULT_NEXT_OPEN_HORIZON_DAYS = 14;

/**
 * Walks forward from `from`'s own Belize calendar date, looking for the next
 * date with an open window - checking exception-then-weekly-then-
 * unconstrained for each candidate date in turn, via the same
 * `effectiveHoursForDate` `resolveHoursStatus` itself uses. Composed ON TOP
 * of the per-date resolver rather than duplicating its logic.
 *
 * BOUNDED at `horizonDays` (default 14): a hub genuinely configured closed
 * every day of the week is a configuration a human can enter, and an
 * unbounded search would hang the caller on it. Returns null when nothing
 * opens within the horizon - the caller decides what "no window found
 * within N days" means for its own flow; this function never invents an
 * answer past the bound by, say, silently extending the search.
 *
 * On `from`'s own day, a window whose close time has already passed `from`'s
 * own time-of-day is in the past, not a next window, and is skipped in
 * favour of a later date - the whole point of "next" is that it is still
 * reachable.
 */
export function nextOpenWindow(
  from: Date,
  weeklyPattern: readonly WeeklyOpeningHours[],
  exceptions: readonly HoursException[],
  horizonDays: number = DEFAULT_NEXT_OPEN_HORIZON_DAYS,
): NextOpenWindow | null {
  const fromMinutes = minutesOfDayBelize(from);
  const dayStart = startOfBelizeDay(from);
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const candidate = new Date(dayStart.getTime() + offset * 24 * 60 * 60_000);
    const eff = effectiveHoursForDate(candidate, weeklyPattern, exceptions);
    if (eff.isClosed) continue;
    if (eff.openTime && eff.closeTime) {
      const close = parseMinutes(eff.closeTime);
      if (offset === 0 && close <= fromMinutes) continue; // today's window already ended
      return { date: belizeCalendarDate(candidate), openTime: eff.openTime, closeTime: eff.closeTime };
    }
    // Unconstrained: open all day, nothing specific configured - a valid
    // "next open" target in its own right, reported with null times rather
    // than inventing hours that were never configured.
    return { date: belizeCalendarDate(candidate), openTime: null, closeTime: null };
  }
  return null;
}

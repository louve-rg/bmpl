/// Answering "does this scheduled service run on this date" from configured
/// data - never invented, never a fabricated calendar. BMPL-186 (route
/// operating-day configuration) is the first consumer; BMPL-177 (terminal /
/// business operating hours) should reuse this SAME resolution shape for
/// hubs and vendors rather than writing a second one, even though its weekly
/// rows live on a different table with different columns (open/close time
/// instead of a status).
///
/// Framework-free by design (root CLAUDE.md sec 2): the API and any future
/// browser-side "is this route running today" preview must agree, and a rule
/// stated twice is a rule that eventually disagrees with itself.

export const SERVICE_OPERATING_STATUSES = ['OPERATING', 'REDUCED', 'NOT_OPERATING'] as const;
export type ServiceOperatingStatus = (typeof SERVICE_OPERATING_STATUSES)[number];

export const SERVICE_OPERATING_STATUS_LABELS: Record<ServiceOperatingStatus, string> = {
  OPERATING: 'Operating',
  REDUCED: 'Reduced schedule',
  NOT_OPERATING: 'Not operating',
};

export interface WeeklyOperatingDay {
  /**
   * 0=Sunday .. 6=Saturday, matching VendorOpeningHours - but resolved against
   * Belize LOCAL time (see `toBelizeLocal` below), not JS Date#getUTCDay().
   */
  dayOfWeek: number;
  status: ServiceOperatingStatus;
  note?: string | null;
}

export interface ScheduleException {
  /** A calendar date - the time-of-day component is ignored by design. */
  date: Date;
  status: ServiceOperatingStatus;
  reason?: string | null;
}

export interface ScheduleResolution {
  status: ServiceOperatingStatus;
  /** True when a date-specific exception decided this, not the weekly default. */
  isException: boolean;
  note: string | null;
}

/**
 * Belize is UTC-6 year-round - it has never observed daylight saving - so a
 * fixed offset correctly answers "what is Belize's local calendar date/weekday
 * right now" without pulling in an IANA timezone database for a
 * framework-free package (root CLAUDE.md sec 2). If Belize is ever confirmed
 * to have adopted DST, this constant is the one place that would need to
 * become a real zone lookup.
 */
const BELIZE_UTC_OFFSET_MINUTES = -6 * 60;

/**
 * Shifts a UTC instant so that calling the `getUTC*` family on the result
 * yields Belize LOCAL calendar values instead of UTC ones. This is the ONLY
 * place a date crosses from "instant" to "Belize calendar day" - every caller
 * of `resolveScheduleStatus` passes a raw instant (e.g. `new Date()`) and
 * relies on this conversion happening here, once, rather than converting
 * (or forgetting to convert) at each call site.
 */
const toBelizeLocal = (d: Date): Date => new Date(d.getTime() + BELIZE_UTC_OFFSET_MINUTES * 60_000);

/**
 * Reads y/m/d off a Date via the UTC accessors with NO further shift. This is
 * for `ScheduleException.date`, which is a pure calendar date (Prisma
 * `@db.Date`, normalised to UTC midnight by the caller that stored it - see
 * `addScheduleException`) - it names a day, not an instant, so it must NOT go
 * through `toBelizeLocal` a second time or it would land on the wrong day.
 */
const calendarDateKey = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Which Belize calendar day a real instant (e.g. `new Date()`) falls on. */
const instantDateKey = (d: Date): string => calendarDateKey(toBelizeLocal(d));

/**
 * Whether a route/service operates on `date`, and how.
 *
 * An exception for the exact date always wins. Absent one, the weekly pattern
 * for that day-of-week applies. Absent a weekly row too, the route is treated
 * as OPERATING - the same "no closure recorded" assumption a bare
 * `scheduleNote` label always implied, so configuring nothing changes nothing.
 */
export function resolveScheduleStatus(
  date: Date,
  weeklyPattern: readonly WeeklyOperatingDay[],
  exceptions: readonly ScheduleException[],
): ScheduleResolution {
  const target = instantDateKey(date);
  const exception = exceptions.find((e) => calendarDateKey(e.date) === target);
  if (exception) {
    return { status: exception.status, isException: true, note: exception.reason ?? null };
  }
  const weekday = toBelizeLocal(date).getUTCDay();
  const day = weeklyPattern.find((d) => d.dayOfWeek === weekday);
  if (day) {
    return { status: day.status, isException: false, note: day.note ?? null };
  }
  return { status: 'OPERATING', isException: false, note: null };
}

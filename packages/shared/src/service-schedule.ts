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

import { belizeCalendarDateKey, belizeWeekday } from './belize-time';

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
   * Belize LOCAL time (see `belizeWeekday` in ./belize-time), not JS
   * Date#getUTCDay().
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
  const target = belizeCalendarDateKey(date);
  // ScheduleException.date is already a pure calendar date (Prisma @db.Date,
  // UTC-midnight normalized by the caller that stored it) - format it
  // directly, with no Belize shift, or it would land on the wrong day.
  const exception = exceptions.find((e) => e.date.toISOString().slice(0, 10) === target);
  if (exception) {
    return { status: exception.status, isException: true, note: exception.reason ?? null };
  }
  const weekday = belizeWeekday(date);
  const day = weeklyPattern.find((d) => d.dayOfWeek === weekday);
  if (day) {
    return { status: day.status, isException: false, note: day.note ?? null };
  }
  return { status: 'OPERATING', isException: false, note: null };
}

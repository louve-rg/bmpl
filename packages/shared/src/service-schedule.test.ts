import { describe, expect, it } from 'vitest';
import { resolveScheduleStatus, type ScheduleException, type WeeklyOperatingDay } from './service-schedule';

// A synthetic route, obviously not a real one - Sunday reduced, Wednesday closed.
const weekly: WeeklyOperatingDay[] = [
  { dayOfWeek: 0, status: 'REDUCED', note: 'Synthetic test note: one vessel only' },
  { dayOfWeek: 3, status: 'NOT_OPERATING' },
];

/**
 * An instant at Belize local `hour`:00 on the given Belize calendar date.
 * Belize is a fixed UTC-6 with no daylight saving (see service-schedule.ts),
 * so the UTC instant is simply the local wall-clock time plus 6 hours -
 * BMPL-196's whole point is that these two are NOT the same calendar date
 * for six hours of every evening, so fixtures must say which one they mean.
 */
const belizeInstant = (year: number, month: number, day: number, hour = 12): Date =>
  new Date(Date.UTC(year, month - 1, day, hour + 6, 0, 0));

/** A pure calendar date, no time-of-day - how RouteScheduleException.date is stored. */
const calendarDate = (year: number, month: number, day: number): Date => new Date(Date.UTC(year, month - 1, day));

const sunday = belizeInstant(2026, 11, 1); // Belize noon, a Sunday
const wednesday = belizeInstant(2026, 11, 4); // Belize noon, a Wednesday
const tuesday = belizeInstant(2026, 11, 3); // Belize noon, a Tuesday, no configured row

describe('resolveScheduleStatus', () => {
  it('falls back to OPERATING for an unconfigured day', () => {
    expect(resolveScheduleStatus(tuesday, weekly, [])).toEqual({ status: 'OPERATING', isException: false, note: null });
  });

  it('applies the weekly pattern for a configured day-of-week', () => {
    expect(resolveScheduleStatus(sunday, weekly, [])).toEqual({
      status: 'REDUCED',
      isException: false,
      note: 'Synthetic test note: one vessel only',
    });
    expect(resolveScheduleStatus(wednesday, weekly, [])).toEqual({ status: 'NOT_OPERATING', isException: false, note: null });
  });

  it('lets a date-specific exception override the weekly default', () => {
    const exceptions: ScheduleException[] = [
      { date: calendarDate(2026, 11, 1), status: 'NOT_OPERATING', reason: 'Synthetic test holiday' },
    ];
    expect(resolveScheduleStatus(sunday, weekly, exceptions)).toEqual({
      status: 'NOT_OPERATING',
      isException: true,
      note: 'Synthetic test holiday',
    });
  });

  it('lets an exception apply even on a day with no weekly row', () => {
    const exceptions: ScheduleException[] = [{ date: calendarDate(2026, 11, 3), status: 'REDUCED', reason: null }];
    expect(resolveScheduleStatus(tuesday, weekly, exceptions)).toEqual({ status: 'REDUCED', isException: true, note: null });
  });

  it('matches an exception on the calendar date, ignoring any time-of-day component', () => {
    const lateEveningStillSundayInBelize = belizeInstant(2026, 11, 1, 23);
    const exceptions: ScheduleException[] = [{ date: calendarDate(2026, 11, 1), status: 'NOT_OPERATING' }];
    expect(resolveScheduleStatus(lateEveningStillSundayInBelize, weekly, exceptions).status).toBe('NOT_OPERATING');
  });

  // BMPL-196 regression: Belize is UTC-6 with no daylight saving, so Belize
  // local 18:00-23:59 is already TOMORROW's calendar date and weekday in UTC.
  // Run this against the pre-fix resolver (UTC accessors, no Belize
  // conversion) and it fails: a route closed only on Wednesdays reads as
  // closed on Tuesday evening too, because the UTC instant has already
  // rolled to Wednesday.
  it('resolves the 18:00-to-midnight Belize evening window to the BELIZE weekday, not the UTC one', () => {
    // Tuesday 2026-11-03, 20:00 Belize local time.
    const tuesdayEveningBelize = belizeInstant(2026, 11, 3, 20);
    expect(tuesdayEveningBelize.toISOString()).toBe('2026-11-04T02:00:00.000Z');
    expect(tuesdayEveningBelize.getUTCDay()).toBe(3); // sanity: UTC already says Wednesday

    const result = resolveScheduleStatus(tuesdayEveningBelize, weekly, []);
    // Belize local day is still Tuesday (dayOfWeek 2, no configured row), so
    // this must fall back to OPERATING - not the Wednesday NOT_OPERATING row
    // a UTC-only reading would wrongly select.
    expect(result).toEqual({ status: 'OPERATING', isException: false, note: null });
  });
});

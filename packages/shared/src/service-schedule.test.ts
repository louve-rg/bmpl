import { describe, expect, it } from 'vitest';
import { resolveScheduleStatus, type ScheduleException, type WeeklyOperatingDay } from './service-schedule';

// A synthetic route, obviously not a real one - Sunday reduced, Wednesday closed.
const weekly: WeeklyOperatingDay[] = [
  { dayOfWeek: 0, status: 'REDUCED', note: 'Synthetic test note: one vessel only' },
  { dayOfWeek: 3, status: 'NOT_OPERATING' },
];

const sunday = new Date('2026-11-01T00:00:00.000Z'); // a Sunday
const wednesday = new Date('2026-11-04T00:00:00.000Z'); // a Wednesday
const tuesday = new Date('2026-11-03T00:00:00.000Z'); // a Tuesday, no configured row

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
      { date: sunday, status: 'NOT_OPERATING', reason: 'Synthetic test holiday' },
    ];
    expect(resolveScheduleStatus(sunday, weekly, exceptions)).toEqual({
      status: 'NOT_OPERATING',
      isException: true,
      note: 'Synthetic test holiday',
    });
  });

  it('lets an exception apply even on a day with no weekly row', () => {
    const exceptions: ScheduleException[] = [{ date: tuesday, status: 'REDUCED', reason: null }];
    expect(resolveScheduleStatus(tuesday, weekly, exceptions)).toEqual({ status: 'REDUCED', isException: true, note: null });
  });

  it('matches an exception on the calendar date, ignoring any time-of-day component', () => {
    const laterSameDay = new Date('2026-11-01T23:59:00.000Z');
    const exceptions: ScheduleException[] = [{ date: new Date('2026-11-01T05:00:00.000Z'), status: 'NOT_OPERATING' }];
    expect(resolveScheduleStatus(laterSameDay, weekly, exceptions).status).toBe('NOT_OPERATING');
  });
});

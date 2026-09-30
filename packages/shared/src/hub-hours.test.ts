import { describe, expect, it } from 'vitest';
import {
  nextOpenWindow,
  resolveHoursStatus,
  windowStartInstant,
  type HoursException,
  type NextOpenWindow,
  type WeeklyOpeningHours,
} from './hub-hours';

/**
 * An instant at Belize local `hour`:`minute` on the given Belize calendar
 * date. Belize is a fixed UTC-6 with no daylight saving (see belize-time.ts),
 * so the UTC instant is simply the local wall-clock time plus 6 hours.
 */
const belizeInstant = (year: number, month: number, day: number, hour = 12, minute = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour + 6, minute, 0));

/** A pure calendar date, no time-of-day - how HoursException.date is stored. */
const calendarDate = (year: number, month: number, day: number): Date => new Date(Date.UTC(year, month - 1, day));

// A synthetic hub, obviously not a real one - open Mon-Fri 08:00-17:00,
// closed Sat/Sun.
const weekly: WeeklyOpeningHours[] = [
  { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true }, // Sunday
  { dayOfWeek: 1, openTime: '08:00', closeTime: '17:00', isClosed: false },
  { dayOfWeek: 2, openTime: '08:00', closeTime: '17:00', isClosed: false },
  { dayOfWeek: 3, openTime: '08:00', closeTime: '17:00', isClosed: false },
  { dayOfWeek: 4, openTime: '08:00', closeTime: '17:00', isClosed: false },
  { dayOfWeek: 5, openTime: '08:00', closeTime: '17:00', isClosed: false },
  { dayOfWeek: 6, openTime: null, closeTime: null, isClosed: true }, // Saturday
];

const monday = (h = 12, m = 0) => belizeInstant(2026, 11, 2, h, m); // 2026-11-02 is a Monday
const sunday = (h = 12, m = 0) => belizeInstant(2026, 11, 1, h, m);

describe('resolveHoursStatus', () => {
  it('a hub with no rows at all is unconstrained - open, with no window to report', () => {
    expect(resolveHoursStatus(monday(3, 0), [], [])).toEqual({
      isOpen: true,
      openTime: null,
      closeTime: null,
      isException: false,
      reason: null,
    });
  });

  it('applies the weekly pattern for a configured day-of-week', () => {
    expect(resolveHoursStatus(monday(12, 0), weekly, [])).toEqual({
      isOpen: true,
      openTime: '08:00',
      closeTime: '17:00',
      isException: false,
      reason: null,
    });
    expect(resolveHoursStatus(sunday(12, 0), weekly, []).isOpen).toBe(false);
  });

  it('is open exactly AT openTime (inclusive start)', () => {
    expect(resolveHoursStatus(monday(8, 0), weekly, []).isOpen).toBe(true);
  });

  it('is NOT open exactly AT closeTime (exclusive end) - the instant it locks up', () => {
    expect(resolveHoursStatus(monday(17, 0), weekly, []).isOpen).toBe(false);
  });

  it('is open one minute before close and closed one minute before open', () => {
    expect(resolveHoursStatus(monday(16, 59), weekly, []).isOpen).toBe(true);
    expect(resolveHoursStatus(monday(7, 59), weekly, []).isOpen).toBe(false);
  });

  it('an exception CLOSES a normally-open weekday', () => {
    const exceptions: HoursException[] = [{ date: calendarDate(2026, 11, 2), status: 'CLOSED', reason: 'Synthetic test holiday' }];
    expect(resolveHoursStatus(monday(12, 0), weekly, exceptions)).toEqual({
      isOpen: false,
      openTime: null,
      closeTime: null,
      isException: true,
      reason: 'Synthetic test holiday',
    });
  });

  it('an exception SHIFTS the hours rather than closing the day', () => {
    const exceptions: HoursException[] = [
      { date: calendarDate(2026, 11, 2), status: 'MODIFIED', openTime: '10:00', closeTime: '13:00', reason: 'Synthetic test: half day' },
    ];
    // 09:00 would be open under the weekly default (08:00-17:00) but the
    // exception's own window has not started yet.
    expect(resolveHoursStatus(monday(9, 0), weekly, exceptions)).toEqual({
      isOpen: false,
      openTime: '10:00',
      closeTime: '13:00',
      isException: true,
      reason: 'Synthetic test: half day',
    });
    expect(resolveHoursStatus(monday(11, 0), weekly, exceptions).isOpen).toBe(true);
    // 15:00 would be open under the weekly default too, but the exception's
    // window already closed by then.
    expect(resolveHoursStatus(monday(15, 0), weekly, exceptions).isOpen).toBe(false);
  });

  it('lets an exception apply even on a day with no weekly row', () => {
    const exceptions: HoursException[] = [{ date: calendarDate(2026, 11, 1), status: 'MODIFIED', openTime: '10:00', closeTime: '14:00' }];
    // Sunday has an explicit isClosed weekly row above, but the exception still wins.
    expect(resolveHoursStatus(sunday(11, 0), weekly, exceptions).isOpen).toBe(true);
    expect(resolveHoursStatus(sunday(15, 0), weekly, exceptions).isOpen).toBe(false);
  });

  // BMPL-196-style regression: Belize is UTC-6 with no daylight saving, so
  // Belize local 18:00-23:59 is already TOMORROW's calendar date and weekday
  // in UTC. Run this against a UTC-only resolver and it fails: a hub closed
  // only on Sundays reads as closed on Saturday evening too, because the UTC
  // instant has already rolled to Sunday.
  it('resolves the Belize evening window to the BELIZE weekday, not the UTC one', () => {
    const saturdayEveningBelize = belizeInstant(2026, 10, 31, 20, 0); // Saturday 20:00 Belize local
    expect(saturdayEveningBelize.getUTCDay()).toBe(0); // sanity: UTC already says Sunday
    // Belize local day is still Saturday (isClosed row), not Sunday - closed
    // either way here, but for the RIGHT reason: the Saturday row, not a
    // wrongly-selected Sunday one.
    const result = resolveHoursStatus(saturdayEveningBelize, weekly, []);
    expect(result.isOpen).toBe(false);
    expect(result.isException).toBe(false);
  });
});

describe('nextOpenWindow', () => {
  it('finds the next weekly window from a currently-closed date', () => {
    // Saturday - closed. Next open window is Monday 08:00-17:00.
    const saturday = belizeInstant(2026, 10, 31, 9, 0);
    const result = nextOpenWindow(saturday, weekly, []);
    expect(result).toEqual<NextOpenWindow>({ date: calendarDate(2026, 11, 2), openTime: '08:00', closeTime: '17:00' });
  });

  it("returns TODAY's window when it has not ended yet, even before it opens", () => {
    const result = nextOpenWindow(monday(6, 0), weekly, []); // Monday 06:00, before opening
    expect(result).toEqual<NextOpenWindow>({ date: calendarDate(2026, 11, 2), openTime: '08:00', closeTime: '17:00' });
  });

  it("skips TODAY's window once it has already ended, moving to the next date", () => {
    const result = nextOpenWindow(monday(18, 0), weekly, []); // Monday 18:00, after closing
    // Tuesday is next.
    expect(result).toEqual<NextOpenWindow>({ date: calendarDate(2026, 11, 3), openTime: '08:00', closeTime: '17:00' });
  });

  it('reports an unconstrained future date with null times rather than inventing hours', () => {
    const result = nextOpenWindow(belizeInstant(2026, 11, 5, 20, 0), [], []); // no rows anywhere
    expect(result).toEqual<NextOpenWindow>({ date: calendarDate(2026, 11, 5), openTime: null, closeTime: null });
  });

  it('an exception can supply the next window on a day the weekly pattern has closed', () => {
    const exceptions: HoursException[] = [{ date: calendarDate(2026, 11, 1), status: 'MODIFIED', openTime: '10:00', closeTime: '12:00' }];
    const saturday = belizeInstant(2026, 10, 31, 9, 0); // Saturday, closed
    const result = nextOpenWindow(saturday, weekly, exceptions);
    // Sunday (via the exception) comes before Monday (via the weekly pattern).
    expect(result).toEqual<NextOpenWindow>({ date: calendarDate(2026, 11, 1), openTime: '10:00', closeTime: '12:00' });
  });

  it('hits its bound and returns null for a hub configured closed every day', () => {
    const closedEveryDay: WeeklyOpeningHours[] = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      openTime: null,
      closeTime: null,
      isClosed: true,
    }));
    const result = nextOpenWindow(monday(9, 0), closedEveryDay, [], 14);
    expect(result).toBeNull();
  });

  it('respects a caller-supplied horizon smaller than the actual next window', () => {
    // Closed every day except one, 20 days out - past a 14-day horizon.
    const mostlyClosed: WeeklyOpeningHours[] = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      openTime: null,
      closeTime: null,
      isClosed: true,
    }));
    const farException: HoursException[] = [{ date: calendarDate(2026, 11, 22), status: 'MODIFIED', openTime: '09:00', closeTime: '10:00' }];
    expect(nextOpenWindow(monday(9, 0), mostlyClosed, farException, 14)).toBeNull();
    // The same search with a longer horizon finds it.
    expect(nextOpenWindow(monday(9, 0), mostlyClosed, farException, 21)).toEqual<NextOpenWindow>({
      date: calendarDate(2026, 11, 22),
      openTime: '09:00',
      closeTime: '10:00',
    });
  });
});

describe('windowStartInstant (BMPL-340)', () => {
  it('a configured window resolves to its own open time, as a real instant', () => {
    const window: NextOpenWindow = { date: calendarDate(2026, 11, 2), openTime: '08:00', closeTime: '17:00' };
    expect(windowStartInstant(window, monday(3, 0))).toEqual(monday(8, 0));
  });

  it('an unconstrained window (both times null) resolves to that day\'s own Belize midnight', () => {
    const window: NextOpenWindow = { date: calendarDate(2026, 11, 2), openTime: null, closeTime: null };
    expect(windowStartInstant(window, belizeInstant(2026, 10, 30, 12, 0))).toEqual(belizeInstant(2026, 11, 2, 0, 0));
  });

  it('clamps to `from` rather than reporting a start in `from`\'s own past', () => {
    // The window opened at 08:00 but `from` is already 10:00 the same day
    // (e.g. nextOpenWindow was searched from a later projected instant) —
    // the window is still the right DAY, just not honestly "starting" before
    // the instant the caller is projecting from.
    const window: NextOpenWindow = { date: calendarDate(2026, 11, 2), openTime: '08:00', closeTime: '17:00' };
    expect(windowStartInstant(window, monday(10, 0))).toEqual(monday(10, 0));
  });
});

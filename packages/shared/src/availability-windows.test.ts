import { describe, expect, it } from 'vitest';
import { isAvailable, type AvailabilityWindow } from './availability-windows';

/** An instant at Belize local `hour`:`minute` (fixed UTC-6, no DST). */
const belizeInstant = (year: number, month: number, day: number, hour = 12, minute = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour + 6, minute, 0));

describe('isAvailable', () => {
  it('no windows for the role at all means unconstrained — available at any time', () => {
    const windows: AvailabilityWindow[] = [{ role: 'RECIPIENT', startTime: '09:00', endTime: '12:00' }];
    // Nothing recorded for SENDER: querying SENDER must not fall through to
    // RECIPIENT's rows.
    expect(isAvailable(belizeInstant(2026, 11, 2, 3, 0), windows, 'SENDER')).toBe(true);
    expect(isAvailable(belizeInstant(2026, 11, 2, 3, 0), [], 'SENDER')).toBe(true);
  });

  it('a same-day window: inside matches, outside does not, inclusive-open/exclusive-close', () => {
    const windows: AvailabilityWindow[] = [{ role: 'SENDER', startTime: '09:00', endTime: '12:00' }];
    expect(isAvailable(belizeInstant(2026, 11, 2, 10, 0), windows, 'SENDER')).toBe(true);
    expect(isAvailable(belizeInstant(2026, 11, 2, 9, 0), windows, 'SENDER')).toBe(true); // exact open
    expect(isAvailable(belizeInstant(2026, 11, 2, 12, 0), windows, 'SENDER')).toBe(false); // exact close
    expect(isAvailable(belizeInstant(2026, 11, 2, 8, 59), windows, 'SENDER')).toBe(false);
    expect(isAvailable(belizeInstant(2026, 11, 2, 13, 0), windows, 'SENDER')).toBe(false);
  });

  it('multiple windows for the same role are OR-ed — matching any one is enough', () => {
    const windows: AvailabilityWindow[] = [
      { role: 'SENDER', startTime: '09:00', endTime: '12:00' },
      { role: 'SENDER', startTime: '14:00', endTime: '17:00' },
    ];
    expect(isAvailable(belizeInstant(2026, 11, 2, 10, 0), windows, 'SENDER')).toBe(true);
    expect(isAvailable(belizeInstant(2026, 11, 2, 15, 0), windows, 'SENDER')).toBe(true);
    expect(isAvailable(belizeInstant(2026, 11, 2, 13, 0), windows, 'SENDER')).toBe(false); // the gap between them
  });

  it('a role is checked only against its OWN windows, never the other role\'s', () => {
    const windows: AvailabilityWindow[] = [{ role: 'RECIPIENT', startTime: '09:00', endTime: '12:00' }];
    expect(isAvailable(belizeInstant(2026, 11, 2, 10, 0), windows, 'RECIPIENT')).toBe(true);
    expect(isAvailable(belizeInstant(2026, 11, 2, 10, 0), windows, 'SENDER')).toBe(true); // unconstrained for SENDER
  });

  // OVERNIGHT — BMPL-285's own obligation, discharged here: storable and
  // interpreted deliberately, not refused and not silently never-matching.
  it('an overnight window (22:00-02:00) matches BOTH sides of midnight, and the gap does not', () => {
    const windows: AvailabilityWindow[] = [{ role: 'RECIPIENT', startTime: '22:00', endTime: '02:00' }];
    expect(isAvailable(belizeInstant(2026, 11, 2, 23, 0), windows, 'RECIPIENT')).toBe(true); // before midnight
    expect(isAvailable(belizeInstant(2026, 11, 2, 22, 0), windows, 'RECIPIENT')).toBe(true); // exact open
    expect(isAvailable(belizeInstant(2026, 11, 2, 1, 0), windows, 'RECIPIENT')).toBe(true); // after midnight
    expect(isAvailable(belizeInstant(2026, 11, 2, 2, 0), windows, 'RECIPIENT')).toBe(false); // exact close
    expect(isAvailable(belizeInstant(2026, 11, 2, 12, 0), windows, 'RECIPIENT')).toBe(false); // the daytime gap
    expect(isAvailable(belizeInstant(2026, 11, 2, 21, 59), windows, 'RECIPIENT')).toBe(false);
  });

  it('an overnight window combined with a same-day window for the same role both apply', () => {
    const windows: AvailabilityWindow[] = [
      { role: 'SENDER', startTime: '22:00', endTime: '02:00' },
      { role: 'SENDER', startTime: '09:00', endTime: '12:00' },
    ];
    expect(isAvailable(belizeInstant(2026, 11, 2, 10, 0), windows, 'SENDER')).toBe(true); // the same-day one
    expect(isAvailable(belizeInstant(2026, 11, 2, 23, 0), windows, 'SENDER')).toBe(true); // the overnight one
    expect(isAvailable(belizeInstant(2026, 11, 2, 15, 0), windows, 'SENDER')).toBe(false);
  });

  it('reads Belize LOCAL time, not the instant\'s own UTC clock reading', () => {
    // 04:30 UTC is 22:30 Belize the PREVIOUS calendar day (UTC-6) — an
    // overnight-window regression in the style of hub-hours.test.ts's own
    // BMPL-196 check: getting the offset wrong reads this as inside a
    // "09:00-12:00" window (04:30 UTC's own clock reading) when it is
    // actually 22:30 Belize local, matched by the overnight window instead.
    const instant = new Date('2026-11-03T04:30:00.000Z');
    const daytime: AvailabilityWindow[] = [{ role: 'SENDER', startTime: '09:00', endTime: '12:00' }];
    const overnight: AvailabilityWindow[] = [{ role: 'SENDER', startTime: '22:00', endTime: '02:00' }];
    expect(isAvailable(instant, daytime, 'SENDER')).toBe(false);
    expect(isAvailable(instant, overnight, 'SENDER')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { belizeCalendarDate, belizeCalendarDateKey, belizeWeekday, startOfBelizeDay } from './belize-time';

// Belize local -> UTC instant, for building unambiguous fixtures.
const belizeInstant = (y: number, m: number, d: number, hour: number, min = 0) => new Date(Date.UTC(y, m - 1, d, hour + 6, min));

describe('belizeCalendarDateKey / belizeWeekday', () => {
  it('reads the Belize calendar day for an instant in the 18:00-midnight evening window', () => {
    // 2026-09-26 is a Saturday in Belize. 20:00 Belize local = 2026-09-27T02:00:00.000Z.
    const eveningInstant = belizeInstant(2026, 9, 26, 20);
    expect(eveningInstant.toISOString()).toBe('2026-09-27T02:00:00.000Z');
    // A UTC-only reading of this same instant would already say Sunday the 27th.
    expect(eveningInstant.getUTCDay()).toBe(0);
    expect(eveningInstant.getUTCDate()).toBe(27);
    // Belize local is still Saturday the 26th.
    expect(belizeCalendarDateKey(eveningInstant)).toBe('2026-09-26');
    expect(belizeWeekday(eveningInstant)).toBe(6); // Saturday
  });

  it('rolls to the next Belize day exactly at Belize midnight (06:00 UTC), not before', () => {
    const justBeforeMidnight = new Date('2026-09-27T05:59:59.999Z'); // 2026-09-26T23:59:59.999 Belize
    const exactlyMidnight = new Date('2026-09-27T06:00:00.000Z'); // 2026-09-27T00:00:00.000 Belize
    expect(belizeCalendarDateKey(justBeforeMidnight)).toBe('2026-09-26');
    expect(belizeCalendarDateKey(exactlyMidnight)).toBe('2026-09-27');
  });

  it('never rolls at UTC midnight (the old, wrong boundary)', () => {
    // 2026-09-26T00:01 UTC is still 2026-09-25 evening in Belize.
    const justAfterUtcMidnight = new Date('2026-09-26T00:01:00.000Z');
    expect(belizeCalendarDateKey(justAfterUtcMidnight)).toBe('2026-09-25');
  });
});

describe('belizeCalendarDate', () => {
  it('returns a UTC-midnight-normalized Date matching the @db.Date storage convention', () => {
    const eveningInstant = belizeInstant(2026, 9, 26, 20);
    const cal = belizeCalendarDate(eveningInstant);
    expect(cal.toISOString()).toBe('2026-09-26T00:00:00.000Z');
  });
});

describe('startOfBelizeDay', () => {
  it('gives the real instant Belize midnight falls at, for a day derived from the evening window', () => {
    const eveningInstant = belizeInstant(2026, 9, 26, 20); // 2026-09-27T02:00:00.000Z
    expect(startOfBelizeDay(eveningInstant).toISOString()).toBe('2026-09-26T06:00:00.000Z');
  });

  it('is idempotent-safe: an instant already at the start of a Belize day maps to itself', () => {
    const startOfDay = belizeInstant(2026, 9, 26, 0);
    expect(startOfBelizeDay(startOfDay).toISOString()).toBe(startOfDay.toISOString());
  });
});

import { describe, expect, it } from 'vitest';
import { vendorClosedBadge, type VendorHoursExceptionPublic, type VendorWeeklyHour } from './vendor-hours';

// 2026-10-05 is a Monday, 2026-10-06 a Tuesday. Noon Belize local = 18:00 UTC
// (Belize is a fixed UTC-6, never DST) — comfortably clear of either midnight
// boundary, matching the convention belize-time.test.ts already uses.
const mondayNoonBelize = new Date('2026-10-05T18:00:00.000Z');

describe('vendorClosedBadge', () => {
  it('is null when nothing is configured — no badge, not "hours unknown"', () => {
    expect(vendorClosedBadge([], [], mondayNoonBelize)).toBeNull();
  });

  it('is null when the weekly pattern says open now', () => {
    const weekly: VendorWeeklyHour[] = [{ dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '17:00' }];
    expect(vendorClosedBadge(weekly, [], mondayNoonBelize)).toBeNull();
  });

  it('shows a badge when the weekly pattern says closed, naming the next real window', () => {
    const weekly: VendorWeeklyHour[] = [
      { dayOfWeek: 1, isClosed: true, openTime: null, closeTime: null },
      { dayOfWeek: 2, isClosed: false, openTime: '09:00', closeTime: '17:00' },
    ];
    const badge = vendorClosedBadge(weekly, [], mondayNoonBelize);
    expect(badge).not.toBeNull();
    expect(badge!.message).toContain('Tuesday, Oct 6');
    expect(badge!.message).toContain('09:00');
  });

  it('a normally-open day with a CLOSED exception shows the badge (the case invisible without exceptions)', () => {
    const weekly: VendorWeeklyHour[] = [{ dayOfWeek: 1, isClosed: false, openTime: '09:00', closeTime: '17:00' }];
    const exceptions: VendorHoursExceptionPublic[] = [
      { date: '2026-10-05', status: 'CLOSED', openTime: null, closeTime: null },
    ];
    const badge = vendorClosedBadge(weekly, exceptions, mondayNoonBelize);
    expect(badge).not.toBeNull();
  });

  it('a normally-closed day with a MODIFIED exception is OPEN, not closed — the case that decided this had to read real exceptions', () => {
    const weekly: VendorWeeklyHour[] = [{ dayOfWeek: 1, isClosed: true, openTime: null, closeTime: null }];
    const exceptions: VendorHoursExceptionPublic[] = [
      { date: '2026-10-05', status: 'MODIFIED', openTime: '10:00', closeTime: '14:00' },
    ];
    // 11:00 Belize local = 17:00 UTC, inside the exception's 10:00-14:00 window.
    const withinException = new Date('2026-10-05T17:00:00.000Z');
    expect(vendorClosedBadge(weekly, exceptions, withinException)).toBeNull();
  });

  it('degrades honestly, with no invented date, when nothing opens within the search horizon', () => {
    const allClosed: VendorWeeklyHour[] = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      isClosed: true,
      openTime: null,
      closeTime: null,
    }));
    const badge = vendorClosedBadge(allClosed, [], mondayNoonBelize);
    expect(badge).not.toBeNull();
    expect(badge!.message).toMatch(/could not confirm/i);
  });

  it('never says or implies the order cannot be placed, and always says it will still be dispatched', () => {
    const weekly: VendorWeeklyHour[] = [
      { dayOfWeek: 1, isClosed: true, openTime: null, closeTime: null },
      { dayOfWeek: 2, isClosed: false, openTime: '09:00', closeTime: '17:00' },
    ];
    const badge = vendorClosedBadge(weekly, [], mondayNoonBelize);
    expect(badge!.message).not.toMatch(/cannot|unable to (order|place)/i);
    expect(badge!.message).toMatch(/dispatched/i);
  });
});

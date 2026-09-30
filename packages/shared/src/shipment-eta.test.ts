import { describe, expect, it } from 'vitest';
import { estimateShipmentEta, type EtaLegInput, type HubHoursByHub } from './shipment-eta';
import type { AvailabilityWindow } from './availability-windows';
import type { WeeklyOpeningHours } from './hub-hours';

/** An instant at Belize local `hour`:`minute` (fixed UTC-6, no DST) — same
 *  helper as hub-hours.test.ts / availability-windows.test.ts. */
const belizeInstant = (year: number, month: number, day: number, hour = 12, minute = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour + 6, minute, 0));

const monday = (h = 12, m = 0) => belizeInstant(2026, 11, 2, h, m); // 2026-11-02 is a Monday

const baseLeg = (overrides: Partial<EtaLegInput>): EtaLegInput => ({
  sequence: 1,
  kind: 'DIRECT',
  status: 'PENDING',
  durationMinutes: 60,
  destinationHubId: null,
  startedAt: null,
  completedAt: null,
  scheduledDepartureAt: null,
  scheduledArrivalAt: null,
  ...overrides,
});

const noWindows: AvailabilityWindow[] = [];
const noHubs: HubHoursByHub = new Map();

describe('estimateShipmentEta — structure', () => {
  it('no legs at all — UNKNOWN, nothing to estimate', () => {
    const result = estimateShipmentEta([], monday(), noHubs, noWindows);
    expect(result).toEqual({ legs: [], confidence: 'UNKNOWN', estimatedArrivalAt: null });
  });

  it('every leg CANCELLED — no live leg left, UNKNOWN', () => {
    const legs = [baseLeg({ sequence: 1, status: 'CANCELLED' })];
    const result = estimateShipmentEta(legs, monday(), noHubs, noWindows);
    expect(result.confidence).toBe('UNKNOWN');
    expect(result.estimatedArrivalAt).toBeNull();
  });

  it('a COMPLETED leg is KNOWN, not projected — reports its own completedAt', () => {
    const completedAt = monday(9, 0);
    const legs = [baseLeg({ status: 'COMPLETED', completedAt })];
    const result = estimateShipmentEta(legs, monday(10, 0), noHubs, noWindows);
    expect(result.confidence).toBe('KNOWN');
    expect(result.estimatedArrivalAt).toEqual(completedAt);
    expect(result.legs[0]).toMatchObject({ confidence: 'KNOWN', estimatedCompletionAt: completedAt, reason: null });
  });

  it('an EXCEPTION leg is UNKNOWN with a named reason, and poisons every leg after it', () => {
    const legs = [
      baseLeg({ sequence: 1, kind: 'FIRST_MILE', status: 'EXCEPTION' }),
      baseLeg({ sequence: 2, kind: 'LAST_MILE', status: 'PENDING' }),
    ];
    const result = estimateShipmentEta(legs, monday(), noHubs, noWindows);
    expect(result.confidence).toBe('UNKNOWN');
    expect(result.legs[0]!.reason).toContain('needs attention');
    expect(result.legs[1]).toMatchObject({ confidence: 'UNKNOWN', reason: 'an earlier leg cannot be estimated yet' });
  });

  it('chains sequentially: a not-yet-started leg is anchored to the PRECEDING leg\'s own completion, not `now`', () => {
    const legOneCompletedAt = monday(9, 0);
    const legs = [
      baseLeg({ sequence: 1, kind: 'FIRST_MILE', status: 'COMPLETED', completedAt: legOneCompletedAt }),
      baseLeg({ sequence: 2, kind: 'LAST_MILE', status: 'PENDING', durationMinutes: 30 }),
    ];
    // `now` is much later than leg one's completion — if the anchor were
    // wrongly `now`, this assertion would fail.
    const result = estimateShipmentEta(legs, monday(14, 0), noHubs, noWindows);
    expect(result.legs[1]!.estimatedCompletionAt).toEqual(monday(9, 30)); // 09:00 + 30min, not 14:00 + 30min
  });

  it('an IN_PROGRESS leg\'s own startedAt anchors its projection, not `now`', () => {
    const startedAt = monday(9, 0);
    const legs = [baseLeg({ status: 'IN_PROGRESS', startedAt, durationMinutes: 45 })];
    const result = estimateShipmentEta(legs, monday(9, 40), noHubs, noWindows); // now is mid-leg
    expect(result.legs[0]!.estimatedCompletionAt).toEqual(monday(9, 45)); // startedAt + 45min, not now + 45min
  });
});

describe('estimateShipmentEta — LINE_HAUL', () => {
  it('a carrier\'s own scheduledArrivalAt is used directly — KNOWN, not a projection', () => {
    const scheduledArrivalAt = monday(18, 0);
    const legs = [baseLeg({ kind: 'LINE_HAUL', scheduledArrivalAt })];
    const result = estimateShipmentEta(legs, monday(), noHubs, noWindows);
    expect(result.legs[0]).toMatchObject({ confidence: 'KNOWN', estimatedCompletionAt: scheduledArrivalAt });
  });

  it('a carrier\'s scheduledDepartureAt (no arrival yet) projects departure + duration', () => {
    const scheduledDepartureAt = monday(15, 0);
    const legs = [baseLeg({ kind: 'LINE_HAUL', durationMinutes: 120, scheduledDepartureAt })];
    const result = estimateShipmentEta(legs, monday(10, 0), noHubs, noWindows);
    expect(result.legs[0]).toMatchObject({ confidence: 'PROJECTED', estimatedCompletionAt: monday(17, 0) });
  });

  it('nothing configured at all — UNKNOWN, honestly, not a guessed transit time', () => {
    const legs = [baseLeg({ kind: 'LINE_HAUL' })];
    const result = estimateShipmentEta(legs, monday(), noHubs, noWindows);
    expect(result.legs[0]).toMatchObject({ confidence: 'UNKNOWN', estimatedCompletionAt: null });
    expect(result.legs[0]!.reason).toContain('no carrier departure');
  });
});

describe('estimateShipmentEta — FIRST_MILE (destination terminal hours)', () => {
  const weekly: WeeklyOpeningHours[] = [
    { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true },
    { dayOfWeek: 1, openTime: '08:00', closeTime: '17:00', isClosed: false },
    { dayOfWeek: 2, openTime: '08:00', closeTime: '17:00', isClosed: false },
    { dayOfWeek: 3, openTime: '08:00', closeTime: '17:00', isClosed: false },
    { dayOfWeek: 4, openTime: '08:00', closeTime: '17:00', isClosed: false },
    { dayOfWeek: 5, openTime: '08:00', closeTime: '17:00', isClosed: false },
    { dayOfWeek: 6, openTime: null, closeTime: null, isClosed: true },
  ];
  const hubHours: HubHoursByHub = new Map([['hub-1', { weeklyPattern: weekly, exceptions: [] }]]);

  it('destination open at the projected arrival — PROJECTED, provisional arrival used as-is', () => {
    const legs = [baseLeg({ kind: 'FIRST_MILE', destinationHubId: 'hub-1', durationMinutes: 60 })];
    const result = estimateShipmentEta(legs, monday(10, 0), hubHours, noWindows);
    expect(result.legs[0]).toMatchObject({ confidence: 'PROJECTED', estimatedCompletionAt: monday(11, 0) });
  });

  it('destination closed at the projected arrival — defers to the terminal\'s own next open window', () => {
    // now=16:30 + 60min duration lands at 17:30, after the 17:00 close.
    const legs = [baseLeg({ kind: 'FIRST_MILE', destinationHubId: 'hub-1', durationMinutes: 60 })];
    const result = estimateShipmentEta(legs, monday(16, 30), hubHours, noWindows);
    expect(result.legs[0]!.confidence).toBe('PROJECTED');
    expect(result.legs[0]!.estimatedCompletionAt).toEqual(belizeInstant(2026, 11, 3, 8, 0)); // Tuesday 08:00
    expect(result.legs[0]!.reason).toContain('waiting for the destination terminal to open');
  });

  it('no hub-hours data supplied for that hub id — treated as unconstrained, not UNKNOWN', () => {
    const legs = [baseLeg({ kind: 'FIRST_MILE', destinationHubId: 'unconfigured-hub', durationMinutes: 60 })];
    const result = estimateShipmentEta(legs, monday(16, 30), noHubs, noWindows);
    expect(result.legs[0]).toMatchObject({ confidence: 'PROJECTED', estimatedCompletionAt: monday(17, 30) });
  });

  it('no open window within the horizon — UNKNOWN, never a guess past it', () => {
    const closedEveryDay: WeeklyOpeningHours[] = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      openTime: null,
      closeTime: null,
      isClosed: true,
    }));
    const hubs: HubHoursByHub = new Map([['hub-1', { weeklyPattern: closedEveryDay, exceptions: [] }]]);
    const legs = [baseLeg({ kind: 'FIRST_MILE', destinationHubId: 'hub-1', durationMinutes: 60 })];
    const result = estimateShipmentEta(legs, monday(), hubs, noWindows);
    expect(result.legs[0]).toMatchObject({ confidence: 'UNKNOWN', estimatedCompletionAt: null });
  });
});

describe('estimateShipmentEta — availability windows (LAST_MILE, DIRECT)', () => {
  it('LAST_MILE: recipient unavailable at the projected delivery instant — defers to their next available window', () => {
    const windows: AvailabilityWindow[] = [{ role: 'RECIPIENT', startTime: '09:00', endTime: '12:00' }];
    const legs = [baseLeg({ kind: 'LAST_MILE', durationMinutes: 60 })];
    // now=13:00 + 60min = 14:00, outside 09:00-12:00 — rolls to tomorrow 09:00.
    const result = estimateShipmentEta(legs, monday(13, 0), noHubs, windows);
    expect(result.legs[0]).toMatchObject({
      confidence: 'PROJECTED',
      estimatedCompletionAt: belizeInstant(2026, 11, 3, 9, 0),
    });
    expect(result.legs[0]!.reason).toContain('availability window');
  });

  it('DIRECT: gated by BOTH sender at pickup and recipient at delivery', () => {
    const windows: AvailabilityWindow[] = [
      { role: 'SENDER', startTime: '14:00', endTime: '17:00' },
      { role: 'RECIPIENT', startTime: '09:00', endTime: '20:00' },
    ];
    const legs = [baseLeg({ kind: 'DIRECT', durationMinutes: 30 })];
    // now=08:00 — sender not ready until 14:00; pickup shifts to 14:00, delivery at 14:30, inside the recipient window.
    const result = estimateShipmentEta(legs, monday(8, 0), noHubs, windows);
    expect(result.legs[0]).toMatchObject({ confidence: 'PROJECTED', estimatedCompletionAt: monday(14, 30) });
  });

  it('no configured windows at all — unconstrained, same as every shipment today', () => {
    const legs = [baseLeg({ kind: 'DIRECT', durationMinutes: 45 })];
    const result = estimateShipmentEta(legs, monday(10, 0), noHubs, noWindows);
    expect(result.legs[0]).toMatchObject({ confidence: 'PROJECTED', estimatedCompletionAt: monday(10, 45) });
  });
});

describe('estimateShipmentEta — overall confidence', () => {
  it('overall confidence is the WEAKEST among live legs — one UNKNOWN leg poisons the whole shipment', () => {
    const legs = [
      baseLeg({ sequence: 1, kind: 'LINE_HAUL', status: 'COMPLETED', completedAt: monday(9, 0) }),
      baseLeg({ sequence: 2, kind: 'LINE_HAUL', status: 'PENDING' }), // nothing configured — UNKNOWN
    ];
    const result = estimateShipmentEta(legs, monday(10, 0), noHubs, noWindows);
    expect(result.confidence).toBe('UNKNOWN');
    expect(result.estimatedArrivalAt).toBeNull();
  });

  it('overall confidence is PROJECTED when every live leg resolved but at least one is not yet KNOWN', () => {
    const legs = [baseLeg({ kind: 'DIRECT', durationMinutes: 30 })];
    const result = estimateShipmentEta(legs, monday(), noHubs, noWindows);
    expect(result.confidence).toBe('PROJECTED');
  });

  it('overall confidence is KNOWN only when every live leg has already completed', () => {
    const legs = [baseLeg({ status: 'COMPLETED', completedAt: monday(9, 0) })];
    const result = estimateShipmentEta(legs, monday(10, 0), noHubs, noWindows);
    expect(result.confidence).toBe('KNOWN');
  });
});

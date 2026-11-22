import { describe, expect, it } from 'vitest';
import { legNeedsCarrier, legState, manualAssignmentIsStale, MANUAL_ASSIGNMENT_STALE_HOURS, type LegStateInput } from './leg-state';

/**
 * P2-SHIPMENT-PARITY: extracted verbatim out of the ops board
 * (`logistics/page.tsx`) so the shipment detail page can import the exact
 * same function once its own payload carries the fields this reads — these
 * are the pre-existing behaviors, pinned here so the extraction (and any
 * later consumer) cannot silently drift from them.
 */

function leg(over: Partial<LegStateInput> = {}): LegStateInput {
  return {
    kind: 'FIRST_MILE',
    status: 'READY',
    operator: null,
    operatedByProviderId: null,
    needsDriver: false,
    ...over,
  };
}

describe('legState', () => {
  it('COMPLETED -> Done, success', () => {
    expect(legState(leg({ status: 'COMPLETED' }))).toEqual({ label: 'Done', tone: 'success' });
  });

  it('EXCEPTION -> Problem, warning', () => {
    expect(legState(leg({ status: 'EXCEPTION' }))).toEqual({ label: 'Problem', tone: 'warning' });
  });

  it('CANCELLED -> Cancelled, neutral', () => {
    expect(legState(leg({ status: 'CANCELLED' }))).toEqual({ label: 'Cancelled', tone: 'neutral' });
  });

  it('needsDriverReason UNAVAILABLE -> No driver online, info -- even when needsDriver is also true', () => {
    expect(legState(leg({ needsDriver: true, needsDriverReason: 'UNAVAILABLE' }))).toEqual({ label: 'No driver online', tone: 'info' });
  });

  it('needsDriver true (no reason, or EXHAUSTED) -> No driver found, warning', () => {
    expect(legState(leg({ needsDriver: true }))).toEqual({ label: 'No driver found', tone: 'warning' });
    expect(legState(leg({ needsDriver: true, needsDriverReason: 'EXHAUSTED' }))).toEqual({ label: 'No driver found', tone: 'warning' });
  });

  it('an unassigned, non-terminal LINE_HAUL leg -> No carrier assigned, warning', () => {
    expect(legState(leg({ kind: 'LINE_HAUL', status: 'READY' }))).toEqual({ label: 'No carrier assigned', tone: 'warning' });
  });

  it('IN_PROGRESS -> Moving, info; READY -> Ready, info; anything else -> Waiting, neutral', () => {
    expect(legState(leg({ status: 'IN_PROGRESS' }))).toEqual({ label: 'Moving', tone: 'info' });
    expect(legState(leg({ status: 'READY' }))).toEqual({ label: 'Ready', tone: 'info' });
    expect(legState(leg({ status: 'PENDING' }))).toEqual({ label: 'Waiting', tone: 'neutral' });
  });
});

describe('legNeedsCarrier', () => {
  it('true only for an unassigned, non-terminal LINE_HAUL leg', () => {
    expect(legNeedsCarrier(leg({ kind: 'LINE_HAUL', status: 'READY' }))).toBe(true);
    expect(legNeedsCarrier(leg({ kind: 'FIRST_MILE', status: 'READY' }))).toBe(false);
    expect(legNeedsCarrier(leg({ kind: 'LINE_HAUL', status: 'COMPLETED' }))).toBe(false);
  });

  it('false once either operator or operatedByProviderId is set', () => {
    expect(legNeedsCarrier(leg({ kind: 'LINE_HAUL', operator: 'Tropic Air' }))).toBe(false);
    expect(legNeedsCarrier(leg({ kind: 'LINE_HAUL', operatedByProviderId: 'prov_1' }))).toBe(false);
  });
});

describe('manualAssignmentIsStale', () => {
  it(`is false just under ${MANUAL_ASSIGNMENT_STALE_HOURS}h old, true at/over it`, () => {
    const now = Date.now();
    const justUnder = new Date(now - (MANUAL_ASSIGNMENT_STALE_HOURS * 60 * 60 * 1000 - 1000)).toISOString();
    const atThreshold = new Date(now - MANUAL_ASSIGNMENT_STALE_HOURS * 60 * 60 * 1000).toISOString();
    expect(manualAssignmentIsStale(justUnder)).toBe(false);
    expect(manualAssignmentIsStale(atThreshold)).toBe(true);
  });
});

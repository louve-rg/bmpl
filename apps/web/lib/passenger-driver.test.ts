import { describe, expect, it } from 'vitest';
import { DRIVER_SETTABLE_AVAILABILITY } from '@bmpl/shared';
import { PASSENGER_AVAILABILITY_OPTIONS, availabilityTone, tripAction } from './passenger-driver';

describe('passenger availability options', () => {
  it('offers exactly the server-settable states — SUSPENDED is never a button', () => {
    expect(PASSENGER_AVAILABILITY_OPTIONS.map((o) => o.value).sort()).toEqual([...DRIVER_SETTABLE_AVAILABILITY].sort());
    expect(PASSENGER_AVAILABILITY_OPTIONS.some((o) => (o.value as string) === 'SUSPENDED')).toBe(false);
  });

  it('gives every option a label and an honest hint', () => {
    for (const o of PASSENGER_AVAILABILITY_OPTIONS) {
      expect(o.label.trim()).not.toBe('');
      expect(o.hint.trim()).not.toBe('');
    }
  });
});

describe('tripAction', () => {
  it('mirrors the two server transitions and nothing else', () => {
    expect(tripAction('ASSIGNED')).toEqual({ action: 'start', label: 'Start trip' });
    expect(tripAction('IN_PROGRESS')).toEqual({ action: 'complete', label: 'Complete trip' });
    // SCHEDULED belongs to the operator, finished states to history; neither
    // gets a movement button, and no en-route state exists in this slice.
    for (const s of ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'EN_ROUTE_TO_PICKUP', '']) {
      expect(tripAction(s)).toBeNull();
    }
  });
});

describe('availabilityTone', () => {
  it('marks online good, break warning, suspension bad, offline neutral', () => {
    expect(availabilityTone('ONLINE')).toBe('success');
    expect(availabilityTone('UNAVAILABLE')).toBe('warning');
    expect(availabilityTone('SUSPENDED')).toBe('error');
    expect(availabilityTone('OFFLINE')).toBe('neutral');
  });
});

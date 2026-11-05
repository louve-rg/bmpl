import { describe, expect, it } from 'vitest';
import { DRIVER_SETTABLE_AVAILABILITY } from '@bmpl/shared';
import { PASSENGER_AVAILABILITY_OPTIONS, availabilityTone, tripAction, tripBookingEndLine, type TripBookingLocation } from './passenger-driver';

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

describe('tripBookingEndLine (MDF-549)', () => {
  const end = (overrides: Partial<TripBookingLocation>): TripBookingLocation => ({
    district: null,
    city: null,
    address: null,
    landmark: null,
    instructions: null,
    latitude: null,
    longitude: null,
    ...overrides,
  });

  it('reads null as the normal "no pin" case, not missing data', () => {
    expect(tripBookingEndLine(null)).toBe('Not specified — travelling to/from the route’s own stop');
  });

  it('prefers the street address when given', () => {
    expect(tripBookingEndLine(end({ address: '5 Burns Ave', city: 'San Ignacio', district: 'CAYO' }))).toBe('5 Burns Ave, San Ignacio, CAYO');
  });

  it('falls back to the landmark when there is no street', () => {
    expect(tripBookingEndLine(end({ landmark: 'Near the market', city: 'Belize City', district: 'BELIZE' }))).toBe('Near the market, Belize City, BELIZE');
  });

  it('falls back to town/district when neither street nor landmark is given', () => {
    expect(tripBookingEndLine(end({ city: 'Belmopan', district: 'CAYO' }))).toBe('Belmopan, CAYO');
  });
});

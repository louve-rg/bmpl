import { describe, expect, it } from 'vitest';
import { passengerBookingCreateSchema, passengerBookingStopSchema } from './passenger';
import { OUT_OF_BOUNDS_MESSAGE, UNLOCATABLE_ADDRESS_MESSAGE } from '@bmpl/shared';

/**
 * Flag-stop pickup/dropoff pins (MDF-548) — "pick me up along the route
 * here", reusing the exact written-down-OR-pinned rule MDF-485 settled
 * (`isLocatable`), not a second one. Town and district stay required
 * regardless, because a pin never implies them.
 */
describe('passengerBookingStopSchema', () => {
  const base = { district: 'BELIZE' as const, city: 'Belize City' };

  it('accepts a pin with no street address at all', () => {
    const r = passengerBookingStopSchema.safeParse({ ...base, latitude: 17.4995, longitude: -88.1976 });
    expect(r.success).toBe(true);
  });

  it('accepts a written address with no pin', () => {
    expect(passengerBookingStopSchema.safeParse({ ...base, address: '5 Front Street' }).success).toBe(true);
  });

  it('rejects a stop that is neither written nor pinned, naming both ways out', () => {
    const r = passengerBookingStopSchema.safeParse(base);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.message).toBe(UNLOCATABLE_ADDRESS_MESSAGE);
      expect(r.error.issues[0]!.message).toContain('drop a pin');
    }
  });

  it('still wants the town and district — a pin does not imply either', () => {
    expect(passengerBookingStopSchema.safeParse({ city: 'Belize City', latitude: 17.4995, longitude: -88.1976 }).success).toBe(false);
    expect(passengerBookingStopSchema.safeParse({ district: 'BELIZE', latitude: 17.4995, longitude: -88.1976 }).success).toBe(false);
  });

  it('refuses half a pin, and a pin outside Belize', () => {
    const half = passengerBookingStopSchema.safeParse({ ...base, latitude: 17.4995 });
    expect(half.success).toBe(false);
    const outside = passengerBookingStopSchema.safeParse({ ...base, latitude: 40.7, longitude: -74 });
    expect(outside.success).toBe(false);
    if (!outside.success) expect(outside.error.issues[0]!.message).toBe(OUT_OF_BOUNDS_MESSAGE);
  });

  it('landmark is distinct from instructions, and both are optional', () => {
    const r = passengerBookingStopSchema.parse({
      ...base,
      address: '5 Front Street',
      landmark: 'Behind the blue gate',
      instructions: 'Call on arrival.',
    });
    expect(r.landmark).toBe('Behind the blue gate');
    expect(r.instructions).toBe('Call on arrival.');
  });

  it('a blank address, landmark or instructions normalises to absent, same as every other written-OR-pinned schema', () => {
    const r = passengerBookingStopSchema.parse({
      ...base,
      latitude: 17.4995,
      longitude: -88.1976,
      address: '  ',
      landmark: '',
      instructions: '   ',
    });
    expect(r.address).toBeUndefined();
    expect(r.landmark).toBeUndefined();
    expect(r.instructions).toBeUndefined();
  });
});

describe('passengerBookingCreateSchema — pickup/dropoff are optional, and cannot name the same place', () => {
  const tripId = 'clh0000000000000000000000';
  const pickup = { district: 'BELIZE' as const, city: 'Belize City', latitude: 17.4995, longitude: -88.1976 };
  const dropoff = { district: 'TOLEDO' as const, city: 'Punta Gorda', latitude: 16.103, longitude: -88.8004 };

  it('books with neither pin, exactly as before this card', () => {
    const r = passengerBookingCreateSchema.safeParse({ tripId, seats: 1 });
    expect(r.success).toBe(true);
  });

  it('books with one or both pins', () => {
    expect(passengerBookingCreateSchema.safeParse({ tripId, seats: 1, pickup }).success).toBe(true);
    expect(passengerBookingCreateSchema.safeParse({ tripId, seats: 1, dropoff }).success).toBe(true);
    expect(passengerBookingCreateSchema.safeParse({ tripId, seats: 1, pickup, dropoff }).success).toBe(true);
  });

  it('refuses identical coordinates for pickup and dropoff', () => {
    const r = passengerBookingCreateSchema.safeParse({ tripId, seats: 1, pickup, dropoff: pickup });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toMatch(/same place/i);
  });

  it('refuses the same written place even phrased with different casing/whitespace', () => {
    const r = passengerBookingCreateSchema.safeParse({
      tripId,
      seats: 1,
      pickup: { district: 'BELIZE', city: 'Belize City', address: '5 Front Street' },
      dropoff: { district: 'BELIZE', city: 'belize city', address: '  5 FRONT STREET  ' },
    });
    expect(r.success).toBe(false);
  });

  it('does NOT refuse one pinned and one written end just because both are "complete" — only a provably identical place', () => {
    // A pinned pickup and a written-only dropoff can never be proven identical
    // from the wire alone, and must not be refused on a guess.
    const r = passengerBookingCreateSchema.safeParse({
      tripId,
      seats: 1,
      pickup,
      dropoff: { district: 'BELIZE', city: 'Belize City', address: 'Right where the pin landed' },
    });
    expect(r.success).toBe(true);
  });
});

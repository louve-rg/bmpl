import { describe, expect, it } from 'vitest';
import { legAssignMode, type AssignableLeg } from './leg-assign';

/**
 * Characterization tests: these record which legs the ops board offers manual
 * dispatch on TODAY, driven by the shared state machine the API also runs.
 */

const leg = (over: Partial<AssignableLeg>): AssignableLeg => ({
  sequence: 1,
  kind: 'FIRST_MILE',
  status: 'READY',
  courierStatus: null,
  ...over,
});

describe('legAssignMode', () => {
  it('offers assign on a never-offered courier leg whose turn it is', () => {
    const l = leg({});
    expect(legAssignMode([l], l)).toBe('assign');
  });

  it('treats PENDING_ASSIGNMENT the same as never-offered', () => {
    const l = leg({ courierStatus: 'PENDING_ASSIGNMENT' });
    expect(legAssignMode([l], l)).toBe('assign');
  });

  it('offers reassign while the leg is assigned, accepted or declined', () => {
    for (const courierStatus of ['ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_DECLINED']) {
      const l = leg({ courierStatus });
      expect(legAssignMode([l], l)).toBe('reassign');
    }
  });

  it('offers nothing once the parcel is picked up — reassignment stops at pickup', () => {
    for (const courierStatus of ['PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING', 'DELIVERED', 'CANCELLED']) {
      const l = leg({ courierStatus });
      expect(legAssignMode([l], l)).toBeNull();
    }
  });

  it('never offers manual dispatch on a transport leg — a carrier runs it, not a driver', () => {
    const l = leg({ kind: 'LINE_HAUL' });
    expect(legAssignMode([l], l)).toBeNull();
  });

  it('offers nothing on a leg the parcel has not reached yet', () => {
    const lineHaul = leg({ sequence: 1, kind: 'LINE_HAUL', status: 'IN_PROGRESS' });
    const lastMile = leg({ sequence: 2, kind: 'LAST_MILE', status: 'READY' });
    expect(legAssignMode([lineHaul, lastMile], lastMile)).toBeNull();
  });

  it('offers the last mile once every earlier leg is completed', () => {
    const lineHaul = leg({ sequence: 1, kind: 'LINE_HAUL', status: 'COMPLETED' });
    const lastMile = leg({ sequence: 2, kind: 'LAST_MILE', status: 'READY' });
    expect(legAssignMode([lineHaul, lastMile], lastMile)).toBe('assign');
  });

  it('a cancelled earlier leg does not block the ones behind it', () => {
    const cancelled = leg({ sequence: 1, status: 'CANCELLED' });
    const lastMile = leg({ sequence: 2, kind: 'LAST_MILE', status: 'READY' });
    expect(legAssignMode([cancelled, lastMile], lastMile)).toBe('assign');
  });

  it('offers nothing on a completed, cancelled or exception leg', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'EXCEPTION']) {
      const l = leg({ status });
      expect(legAssignMode([l], l)).toBeNull();
    }
  });
});

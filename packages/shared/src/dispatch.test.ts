import { describe, expect, it } from 'vitest';
import { DELIVERY_STAGE_LABELS, DELIVERY_STATUSES, deliveryStage } from './dispatch';

describe('deliveryStage', () => {
  const ready = new Date('2026-09-14T12:00:00Z');

  it('a delivery the vendor has not marked ready is AWAITING_VENDOR, not "awaiting driver"', () => {
    expect(deliveryStage({ status: 'PENDING_ASSIGNMENT', readyForDispatchAt: null })).toBe('AWAITING_VENDOR');
  });

  it('ready and unheld is AWAITING_DISPATCH — including after a decline', () => {
    expect(deliveryStage({ status: 'PENDING_ASSIGNMENT', readyForDispatchAt: ready })).toBe('AWAITING_DISPATCH');
    expect(deliveryStage({ status: 'DRIVER_DECLINED', readyForDispatchAt: ready })).toBe('AWAITING_DISPATCH');
  });

  it('a declined delivery whose readiness was never set still reports AWAITING_VENDOR', () => {
    expect(deliveryStage({ status: 'DRIVER_DECLINED', readyForDispatchAt: null })).toBe('AWAITING_VENDOR');
  });

  it('ASSIGNED means offered to a driver who has not answered yet', () => {
    expect(deliveryStage({ status: 'ASSIGNED', readyForDispatchAt: ready })).toBe('OFFERED');
    // An admin can assign before readiness is stamped; the offer is still real.
    expect(deliveryStage({ status: 'ASSIGNED', readyForDispatchAt: null })).toBe('OFFERED');
  });

  it('every accepted-or-later status has NO stage — the status label already tells the truth', () => {
    for (const status of ['DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING', 'DELIVERED', 'CANCELLED'] as const) {
      expect(deliveryStage({ status, readyForDispatchAt: ready })).toBeNull();
      expect(deliveryStage({ status, readyForDispatchAt: null })).toBeNull();
    }
  });

  it('every status is decided — no status falls through undecided', () => {
    for (const status of DELIVERY_STATUSES) {
      const stage = deliveryStage({ status, readyForDispatchAt: ready });
      expect(stage === null || stage in DELIVERY_STAGE_LABELS).toBe(true);
    }
  });

  it('accepts an ISO string timestamp (serialized rows)', () => {
    expect(deliveryStage({ status: 'PENDING_ASSIGNMENT', readyForDispatchAt: ready.toISOString() })).toBe('AWAITING_DISPATCH');
  });
});

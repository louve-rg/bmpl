import { describe, expect, it } from 'vitest';
import { canPerform, DELIVERY_STAGE_LABELS, DELIVERY_STATUSES, deliveryStage } from './dispatch';

describe('canPerform — RAISE_EXCEPTION is scoped to marketplace deliveries (MDF-927)', () => {
  it('an UNMODIFIED courier-leg call site (no entity passed) is refused, not silently allowed', () => {
    // This is exactly the shape of ShipmentLeg's own assertAction wrapper in
    // apps/api/src/shipping/shipment-driver.service.ts — it calls canPerform
    // with two arguments, because it predates this action and was never
    // told about it. If this ever returned true, a courier leg would have
    // silently acquired RAISE_EXCEPTION the moment the enum value existed,
    // with no code change on the shipping side at all.
    expect(canPerform('RAISE_EXCEPTION', 'ARRIVING')).toBe(false);
    expect(canPerform('RAISE_EXCEPTION', 'PICKUP_CONFIRMED')).toBe(false);
    expect(canPerform('RAISE_EXCEPTION', 'IN_TRANSIT')).toBe(false);
  });

  it('explicitly passing entity "LEG" is refused the same way', () => {
    expect(canPerform('RAISE_EXCEPTION', 'ARRIVING', 'LEG')).toBe(false);
  });

  it('entity "DELIVERY" is allowed from its legal states, and only those', () => {
    expect(canPerform('RAISE_EXCEPTION', 'ARRIVING', 'DELIVERY')).toBe(true);
    expect(canPerform('RAISE_EXCEPTION', 'PICKUP_CONFIRMED', 'DELIVERY')).toBe(true);
    expect(canPerform('RAISE_EXCEPTION', 'IN_TRANSIT', 'DELIVERY')).toBe(true);
    expect(canPerform('RAISE_EXCEPTION', 'ASSIGNED', 'DELIVERY')).toBe(false); // before pickup, still refused
  });

  it('an action with no appliesTo restriction is unaffected by entity, exactly as before this change', () => {
    expect(canPerform('ACCEPT', 'ASSIGNED')).toBe(true);
    expect(canPerform('ACCEPT', 'ASSIGNED', 'LEG')).toBe(true);
    expect(canPerform('ACCEPT', 'ASSIGNED', 'DELIVERY')).toBe(true);
    expect(canPerform('CANCEL', 'EXCEPTION')).toBe(true); // CANCEL's own new `from` entry, also unrestricted
  });
});

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
    for (const status of ['DRIVER_ACCEPTED', 'PICKUP_CONFIRMED', 'IN_TRANSIT', 'ARRIVING', 'DELIVERED', 'EXCEPTION', 'CANCELLED'] as const) {
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

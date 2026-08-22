import { describe, expect, it } from 'vitest';
import {
  deriveShipmentStatus,
  isLegActionable,
  needsFirstMile,
  needsLastMile,
  SHIPPING_SERVICES,
  SHIPPING_SERVICE_DESCRIPTIONS,
  SHIPPING_SERVICE_LABELS,
  type LegKind,
  type LegStatus,
  type LegView,
} from './shipping';

/** Terse leg builder: sequence, kind, status. Mode rarely matters here. */
const leg = (sequence: number, kind: LegKind, status: LegStatus): LegView => ({
  sequence,
  kind,
  mode: kind === 'LINE_HAUL' ? 'AIR' : 'LAND',
  status,
});

/** The common door-to-door shape: collect, fly, deliver. */
const d2d = (a: LegStatus, b: LegStatus, c: LegStatus): LegView[] => [
  leg(1, 'FIRST_MILE', a),
  leg(2, 'LINE_HAUL', b),
  leg(3, 'LAST_MILE', c),
];

describe('service types', () => {
  it('covers every service with a label and a customer-facing description', () => {
    for (const s of SHIPPING_SERVICES) {
      expect(SHIPPING_SERVICE_LABELS[s]).toBeTruthy();
      expect(SHIPPING_SERVICE_DESCRIPTIONS[s]).toBeTruthy();
    }
  });

  it('knows which ends BML is responsible for', () => {
    expect([needsFirstMile('DOOR_TO_DOOR'), needsLastMile('DOOR_TO_DOOR')]).toEqual([true, true]);
    expect([needsFirstMile('DOOR_TO_HUB'), needsLastMile('DOOR_TO_HUB')]).toEqual([true, false]);
    expect([needsFirstMile('HUB_TO_DOOR'), needsLastMile('HUB_TO_DOOR')]).toEqual([false, true]);
    expect([needsFirstMile('HUB_TO_HUB'), needsLastMile('HUB_TO_HUB')]).toEqual([false, false]);
  });
});

describe('deriveShipmentStatus', () => {
  it('walks a door-to-door journey through every stage', () => {
    expect(deriveShipmentStatus(d2d('READY', 'PENDING', 'PENDING'), false)).toBe('AWAITING_PICKUP');
    expect(deriveShipmentStatus(d2d('IN_PROGRESS', 'PENDING', 'PENDING'), false)).toBe('FIRST_MILE');
    expect(deriveShipmentStatus(d2d('COMPLETED', 'READY', 'PENDING'), false)).toBe('AT_ORIGIN_HUB');
    expect(deriveShipmentStatus(d2d('COMPLETED', 'IN_PROGRESS', 'PENDING'), false)).toBe('IN_TRANSIT');
    expect(deriveShipmentStatus(d2d('COMPLETED', 'COMPLETED', 'READY'), false)).toBe('AT_DESTINATION_HUB');
    expect(deriveShipmentStatus(d2d('COMPLETED', 'COMPLETED', 'IN_PROGRESS'), false)).toBe('OUT_FOR_DELIVERY');
    expect(deriveShipmentStatus(d2d('COMPLETED', 'COMPLETED', 'COMPLETED'), false)).toBe('DELIVERED');
  });

  it('says "ready to collect", not "delivered", when the journey ends at a terminal', () => {
    // Telling a recipient their parcel was delivered when it is sitting at a
    // terminal waiting for them is the one message we must not send.
    const legs = [leg(1, 'FIRST_MILE', 'COMPLETED'), leg(2, 'LINE_HAUL', 'COMPLETED')];
    expect(deriveShipmentStatus(legs, true)).toBe('AWAITING_COLLECTION');
    expect(deriveShipmentStatus(legs, false)).toBe('DELIVERED');
  });

  it('reports an exception on any leg, wherever it is in the journey', () => {
    expect(deriveShipmentStatus(d2d('COMPLETED', 'EXCEPTION', 'PENDING'), false)).toBe('EXCEPTION');
    expect(deriveShipmentStatus(d2d('EXCEPTION', 'PENDING', 'PENDING'), false)).toBe('EXCEPTION');
  });

  it('is CANCELLED only when nothing is left alive', () => {
    expect(deriveShipmentStatus(d2d('CANCELLED', 'CANCELLED', 'CANCELLED'), false)).toBe('CANCELLED');
    // One cancelled leg among live ones is a re-plan, not a cancelled shipment.
    expect(deriveShipmentStatus(d2d('COMPLETED', 'COMPLETED', 'CANCELLED'), false)).toBe('DELIVERED');
  });

  it('does not claim a hub arrival the parcel has not made', () => {
    // A line-haul sitting READY while its first mile is still running means the
    // parcel is with the courier, not at the terminal.
    expect(deriveShipmentStatus(d2d('IN_PROGRESS', 'READY', 'PENDING'), false)).toBe('FIRST_MILE');
    expect(deriveShipmentStatus(d2d('PENDING', 'READY', 'PENDING'), false)).toBe('AWAITING_PICKUP');
  });

  it('is DRAFT with no legs, and reads legs in sequence order however they arrive', () => {
    expect(deriveShipmentStatus([], false)).toBe('DRAFT');
    const shuffled = [leg(3, 'LAST_MILE', 'PENDING'), leg(1, 'FIRST_MILE', 'COMPLETED'), leg(2, 'LINE_HAUL', 'IN_PROGRESS')];
    expect(deriveShipmentStatus(shuffled, false)).toBe('IN_TRANSIT');
  });
});

describe('isLegActionable', () => {
  it('will not release the last mile before the parcel reaches the destination hub', () => {
    // The whole point of the sequencing rule: no courier is sent to collect from
    // a terminal the parcel is still flying towards.
    expect(isLegActionable(d2d('COMPLETED', 'IN_PROGRESS', 'PENDING'), 3)).toBe(false);
    expect(isLegActionable(d2d('COMPLETED', 'COMPLETED', 'PENDING'), 3)).toBe(true);
  });

  it('releases the first leg immediately and holds the rest', () => {
    const fresh = d2d('PENDING', 'PENDING', 'PENDING');
    expect([1, 2, 3].map((s) => isLegActionable(fresh, s))).toEqual([true, false, false]);
  });

  it('skips over a cancelled earlier leg rather than deadlocking the shipment', () => {
    const legs = d2d('CANCELLED', 'COMPLETED', 'PENDING');
    expect(isLegActionable(legs, 3)).toBe(true);
  });

  it('refuses legs that are already finished or in trouble', () => {
    expect(isLegActionable(d2d('COMPLETED', 'PENDING', 'PENDING'), 1)).toBe(false);
    expect(isLegActionable(d2d('CANCELLED', 'PENDING', 'PENDING'), 1)).toBe(false);
    expect(isLegActionable(d2d('EXCEPTION', 'PENDING', 'PENDING'), 1)).toBe(false);
  });

  it('refuses a leg that is not part of the shipment', () => {
    expect(isLegActionable(d2d('COMPLETED', 'COMPLETED', 'COMPLETED'), 9)).toBe(false);
  });
});

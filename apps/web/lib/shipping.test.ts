import { describe, expect, it } from 'vitest';
import { formatTransitTime, headlineFor, legPhase, shippingMoney, type ShipmentLegView, type ShipmentView } from './shipping';

const leg = (over: Partial<ShipmentLegView> = {}): ShipmentLegView => ({
  id: 'l1',
  sequence: 1,
  kind: 'LINE_HAUL',
  mode: 'AIR',
  modeLabel: 'Flight',
  status: 'PENDING',
  description: 'Flight from A to B',
  priceMinor: 8000,
  durationMinutes: 45,
  isCurrent: false,
  originHub: null,
  destinationHub: null,
  carrier: null,
  scheduleNote: null,
  departedAt: null,
  arrivedAt: null,
  startedAt: null,
  completedAt: null,
  handoffReceivedByName: null,
  exceptionReason: null,
  handoffPin: null,
  ...over,
});

const shipment = (over: Partial<ShipmentView> = {}): ShipmentView => ({
  id: 's1',
  reference: 'BMPL-ABCD2345',
  service: 'DOOR_TO_DOOR',
  serviceLabel: 'Door to door',
  status: 'IN_TRANSIT',
  statusLabel: 'In transit',
  endsAtHub: false,
  quotedTotalMinor: 16700,
  quotedMinutes: 95,
  explanation: 'Collection, then flight, then delivery',
  description: null,
  pieces: 1,
  bookedAt: null,
  deliveredAt: null,
  cancelledAt: null,
  cancellationReason: null,
  exceptionReason: null,
  origin: { name: null, phone: null, address: null, city: null, district: null, latitude: null, longitude: null, instructions: null },
  destination: { name: null, phone: null, address: null, city: null, district: null, latitude: null, longitude: null, instructions: null },
  currentLegSequence: 1,
  legs: [],
  custody: [],
  ...over,
});

describe('shippingMoney', () => {
  it('reads as Belize dollars, not raw minor units', () => {
    expect(shippingMoney(16700)).toBe('BZ$167.00');
    expect(shippingMoney(0)).toBe('BZ$0.00');
    expect(shippingMoney(5)).toBe('BZ$0.05');
  });
});

describe('formatTransitTime', () => {
  it('scales the unit to the length of the journey', () => {
    expect(formatTransitTime(45)).toBe('45 minutes');
    expect(formatTransitTime(120)).toBe('2h');
    expect(formatTransitTime(95)).toBe('1h 35m');
    expect(formatTransitTime(60 * 30)).toBe('1 day');
    expect(formatTransitTime(60 * 24 * 3)).toBe('3 days');
  });

  it('says nothing rather than "0 minutes" when there is no duration', () => {
    // A courier leg has no configured duration, and "0 minutes" would read as a
    // promise of an instant delivery.
    expect(formatTransitTime(0)).toBeNull();
    expect(formatTransitTime(null)).toBeNull();
  });
});

describe('legPhase', () => {
  it('maps each leg status to where it sits in the journey', () => {
    expect(legPhase(leg({ status: 'COMPLETED' }))).toBe('done');
    expect(legPhase(leg({ status: 'IN_PROGRESS' }))).toBe('current');
    expect(legPhase(leg({ status: 'READY', isCurrent: true }))).toBe('current');
    expect(legPhase(leg({ status: 'PENDING' }))).toBe('upcoming');
    expect(legPhase(leg({ status: 'EXCEPTION' }))).toBe('stopped');
    expect(legPhase(leg({ status: 'CANCELLED' }))).toBe('stopped');
  });

  it('treats a completed leg as done even if it is still flagged current', () => {
    expect(legPhase(leg({ status: 'COMPLETED', isCurrent: true }))).toBe('done');
  });
});

describe('headlineFor', () => {
  it('uses the shipment status label for an ordinary journey', () => {
    expect(headlineFor(shipment())).toBe('In transit');
  });

  it('never says "delivered" for a parcel waiting at a terminal — it says where', () => {
    // The one message this system must not send is "delivered" about a parcel
    // sitting on a counter waiting for someone to walk in.
    const s = shipment({
      status: 'AWAITING_COLLECTION',
      statusLabel: 'Ready to collect',
      endsAtHub: true,
      legs: [leg({ destinationHub: { id: 'h1', code: 'SPA', name: 'San Pedro Airstrip', city: 'San Pedro', instructions: null } })],
    });
    expect(headlineFor(s)).toBe('Ready to collect at San Pedro Airstrip');
  });

  it('falls back gracefully when the terminal is not in the payload', () => {
    const s = shipment({ status: 'AWAITING_COLLECTION', statusLabel: 'Ready to collect', legs: [] });
    expect(headlineFor(s)).toBe('Ready to collect');
  });

  it('leads with what went wrong rather than a status nobody can act on', () => {
    const s = shipment({ status: 'EXCEPTION', statusLabel: 'Needs attention', exceptionReason: 'Flight cancelled by the carrier.' });
    expect(headlineFor(s)).toBe('Flight cancelled by the carrier.');
  });

  it('says cancelled before anything else', () => {
    const s = shipment({ status: 'CANCELLED', statusLabel: 'Cancelled', cancelledAt: new Date().toISOString() });
    expect(headlineFor(s)).toBe('Cancelled');
  });
});

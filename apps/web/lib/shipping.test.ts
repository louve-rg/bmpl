import { describe, expect, it } from 'vitest';
import {
  etaLine,
  formatTransitTime,
  headlineFor,
  legEtaNote,
  legPhase,
  shippingMoney,
  showsEta,
  type ShipmentEtaSummary,
  type ShipmentLegEta,
  type ShipmentLegView,
  type ShipmentView,
} from './shipping';

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
  courier: null,
  courierVehicle: null,
  conversationId: null,
  eta: null,
  ...over,
});

const shipment = (over: Partial<ShipmentView> = {}): ShipmentView => ({
  id: 's1',
  reference: 'BML-ABCD2345',
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
  availabilityWindows: [],
  eta: { confidence: 'UNKNOWN', estimatedArrivalAt: null },
  ...over,
});

describe('shippingMoney', () => {
  it('groups thousands with commas, and changes no digit', () => {
    expect(shippingMoney(99999999999)).toBe('BZ$999,999,999.99');
    expect(shippingMoney(123456789)).toBe('BZ$1,234,567.89');
    expect(shippingMoney(100000)).toBe('BZ$1,000.00');
    expect(shippingMoney(99999)).toBe('BZ$999.99');
  });

  it('keeps the sign where it was', () => {
    expect(shippingMoney(-1250)).toBe('BZ$-12.50');
    expect(shippingMoney(-123456)).toBe('BZ$-1,234.56');
  });

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
      legs: [leg({ destinationHub: { id: 'h1', code: 'SPA', name: 'San Pedro Airstrip', city: 'San Pedro', instructions: null, latitude: 17.9139, longitude: -87.9711 } })],
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

describe('showsEta', () => {
  it('hides once there is nothing left to estimate', () => {
    expect(showsEta('DELIVERED')).toBe(false);
    expect(showsEta('CANCELLED')).toBe(false);
  });

  it('shows for every other status, including one it has not seen before', () => {
    expect(showsEta('IN_TRANSIT')).toBe(true);
    expect(showsEta('AWAITING_COLLECTION')).toBe(true);
    expect(showsEta('EXCEPTION')).toBe(true);
    expect(showsEta('SOME_FUTURE_STATUS')).toBe(true);
  });
});

describe('etaLine', () => {
  const summary = (over: Partial<ShipmentEtaSummary> = {}): ShipmentEtaSummary => ({
    confidence: 'PROJECTED',
    estimatedArrivalAt: '2026-10-02T15:00:00.000Z',
    ...over,
  });

  it('says so in plain words when the confidence is UNKNOWN — never a blank, never a date', () => {
    // UNKNOWN is a normal, permanent state (BMPL-340) — even if a stray
    // timestamp were present, the confidence field alone decides the line.
    expect(etaLine(summary({ confidence: 'UNKNOWN', estimatedArrivalAt: '2026-10-02T15:00:00.000Z' }), 'Fri, 2 Oct, 3:00 PM')).toBe(
      "We don’t have an estimate for this yet",
    );
    expect(etaLine(summary({ confidence: 'UNKNOWN', estimatedArrivalAt: null }), null)).toBe(
      "We don’t have an estimate for this yet",
    );
  });

  it('says a carrier-committed or already-finished time as a fact, not a guess', () => {
    expect(etaLine(summary({ confidence: 'KNOWN' }), 'Fri, 2 Oct, 3:00 PM')).toBe('Arriving Fri, 2 Oct, 3:00 PM');
  });

  it('says a computed time as the estimate it is', () => {
    expect(etaLine(summary({ confidence: 'PROJECTED' }), 'Fri, 2 Oct, 3:00 PM')).toBe('Estimated to arrive Fri, 2 Oct, 3:00 PM');
  });

  it('falls back to the unknown line if a date somehow failed to format, rather than rendering a hole', () => {
    expect(etaLine(summary({ confidence: 'PROJECTED' }), null)).toBe("We don’t have an estimate for this yet");
  });

  it('does not throw when eta itself is absent — a real case, not a hypothetical one', () => {
    // web and api deploy independently (Vercel vs. Railway, which runs
    // `prisma migrate deploy` first and is therefore slower). A response can
    // legitimately arrive with no `eta` field at all while api is still
    // rolling out; this must read as UNKNOWN, never crash the page. Cloning
    // through JSON + delete simulates a real wire payload missing the key,
    // not just an in-memory `undefined` a type-only test would miss.
    const raw = JSON.parse(JSON.stringify(shipment())) as Record<string, unknown>;
    delete raw.eta;
    expect(() => etaLine(raw.eta as ShipmentEtaSummary | undefined, null)).not.toThrow();
    expect(etaLine(raw.eta as ShipmentEtaSummary | undefined, null)).toBe("We don’t have an estimate for this yet");
  });
});

describe('legEtaNote', () => {
  const eta = (over: Partial<ShipmentLegEta> = {}): ShipmentLegEta => ({
    sequence: 1,
    confidence: 'UNKNOWN',
    estimatedCompletionAt: null,
    reason: 'no carrier departure has been confirmed for this leg yet',
    ...over,
  });

  it('passes the API reason through unchanged', () => {
    expect(legEtaNote(leg({ eta: eta() }))).toBe('no carrier departure has been confirmed for this leg yet');
  });

  it('is null when the leg carries no eta at all — a cancelled leg, for instance', () => {
    expect(legEtaNote(leg({ eta: null }))).toBeNull();
  });

  it('is null when the eta itself has nothing to say (e.g. a completed leg)', () => {
    expect(legEtaNote(leg({ eta: eta({ confidence: 'KNOWN', reason: null }) }))).toBeNull();
  });

  it('is suppressed when the leg already shows its own exception reason — never say it twice', () => {
    expect(
      legEtaNote(
        leg({
          exceptionReason: 'Flight cancelled by the carrier.',
          eta: eta({ reason: 'this leg needs attention before its onward journey can be estimated' }),
        }),
      ),
    ).toBeNull();
  });
});

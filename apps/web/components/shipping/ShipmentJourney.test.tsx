// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ShipmentJourney } from './ShipmentJourney';
import type { ShipmentLegView, ShipmentView } from '../../lib/shipping';

// react-dom's act() checks this flag; see AvailabilityWindows.test.tsx /
// LocationPicker.test.tsx for the same convention (no @testing-library/react
// dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function leg(over: Partial<ShipmentLegView> = {}): ShipmentLegView {
  return {
    id: 'l1',
    sequence: 1,
    kind: 'FIRST_MILE',
    mode: 'LAND',
    modeLabel: 'Road',
    status: 'PENDING',
    description: null,
    priceMinor: 1000,
    durationMinutes: 30,
    isCurrent: true,
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
  };
}

function shipment(over: Partial<ShipmentView> = {}): ShipmentView {
  return {
    id: 's1',
    reference: 'BML-ABCD2345',
    service: 'DOOR_TO_DOOR',
    serviceLabel: 'Door to door',
    status: 'AWAITING_PICKUP',
    statusLabel: 'Awaiting pickup',
    endsAtHub: false,
    quotedTotalMinor: 5000,
    quotedMinutes: 60,
    collectionCode: null,
    explanation: null,
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
    legs: [leg()],
    custody: [],
    eta: { confidence: 'UNKNOWN', estimatedArrivalAt: null },
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mount(s: ShipmentView) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ShipmentJourney shipment={s} />);
  });
  return container;
}

describe('ShipmentJourney — pickup code (SHIPPING-E2E)', () => {
  it('shows the pickup code while the first-mile leg still needs to be collected', () => {
    const el = mount(shipment({ legs: [leg({ pickupPin: '4821' })] }));
    expect(el.textContent).toContain('Your pickup code');
    expect(el.textContent).toContain('4821');
    expect(el.textContent).toContain('Read this to the driver when they collect the parcel from you.');
  });

  it('shows nothing once pickup is confirmed (API nulls pickupPin — no card, no stale code)', () => {
    const el = mount(shipment({ legs: [leg({ pickupPin: null, status: 'IN_PROGRESS' })] }));
    expect(el.textContent).not.toContain('Your pickup code');
  });

  it('does not crash when pickupPin is absent from the wire entirely (web/api deploy independently)', () => {
    const raw = JSON.parse(JSON.stringify(shipment())) as Record<string, unknown>;
    expect(() => mount(raw as unknown as ShipmentView)).not.toThrow();
    const el = mount(raw as unknown as ShipmentView);
    expect(el.textContent).not.toContain('Your pickup code');
  });

  it('fixes the delivery-code copy so it no longer claims the sender is the only one who needs it', () => {
    const el = mount(shipment({ legs: [leg({ kind: 'LAST_MILE', handoffPin: '1357' })] }));
    expect(el.textContent).toContain('Your delivery code');
    expect(el.textContent).not.toContain('Nobody else needs it');
    expect(el.textContent).toContain('Share this with whoever will receive the parcel');
  });

  it('shows both codes at once when a shipment has not yet been picked up AND the final leg already carries its own delivery code', () => {
    const el = mount(
      shipment({
        legs: [leg({ kind: 'FIRST_MILE', pickupPin: '4821' }), leg({ id: 'l2', sequence: 2, kind: 'LAST_MILE', handoffPin: '1357' })],
      }),
    );
    expect(el.textContent).toContain('Your pickup code');
    expect(el.textContent).toContain('Your delivery code');
  });
});

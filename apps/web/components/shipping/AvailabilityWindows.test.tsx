// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityWindows } from './AvailabilityWindows';
import type { ShipmentLegView, ShipmentView } from '../../lib/shipping';

// react-dom's act() checks this flag; see StorefrontView.test.tsx / LocationPicker.test.tsx
// for the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/shipping')>();
  return { ...actual, shippingApi: { ...actual.shippingApi, setAvailabilityWindows: vi.fn() } };
});

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
    availabilityWindows: [],
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
    root!.render(<AvailabilityWindows shipment={s} onUpdated={() => {}} />);
  });
  return container;
}

describe('AvailabilityWindows — BMPL-349/350', () => {
  it('renders normally with configured windows', () => {
    // IN_PROGRESS (not in NOT_STARTED) so this role renders the read-only
    // "stored windows" text rather than the editable form.
    const el = mount(
      shipment({
        legs: [leg({ status: 'IN_PROGRESS' })],
        availabilityWindows: [{ id: 'w1', role: 'SENDER', startTime: '09:00', endTime: '17:00' }],
      }),
    );
    expect(el.textContent).toContain('9:00 AM–5:00 PM');
  });

  it('does not crash when availabilityWindows is missing from the wire entirely, and degrades to "no window set"', () => {
    const raw = JSON.parse(JSON.stringify(shipment())) as Record<string, unknown>;
    delete raw.availabilityWindows;
    expect(() => mount(raw as unknown as ShipmentView)).not.toThrow();
    const el = mount(raw as unknown as ShipmentView);
    expect(el.textContent).toContain("No window set — we'll attempt this at any time.");
  });
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepartureCard } from './DeparturesList';
import type { Departure } from '../../lib/passenger-travel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-549: pickup/dropoff capture on the one rider booking form that exists.
 * Both are OPTIONAL (every `pickup*`/`dropoff*` column on `PassengerBooking`
 * is nullable, and a published route already has its own stops) -- each is
 * its own checkbox, off by default, and checking one reveals a real,
 * unmocked `AddressField` (same `next/dynamic`+Leaflet mount BMPL-380/
 * MDF-511 already proved and documented; same leaflet fake and polling
 * `flush`/`waitForNoPulse` as `checkout/page.test.tsx`, reused rather than
 * reinvented).
 */
const apiPost = vi.fn((_path: string, _body?: unknown) => Promise.resolve({}));
// `errorMessage` kept real via `importOriginal` -- the AddressField these
// tests reveal (pickup/dropoff) imports it from this same mocked module.
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    get: vi.fn(() => Promise.resolve([])),
    post: (...args: [string, unknown?]) => apiPost(...args),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(() => ({
      setView: vi.fn(),
      on: vi.fn(),
      getZoom: vi.fn(() => 13),
      invalidateSize: vi.fn(),
      remove: vi.fn(),
      fitBounds: vi.fn(),
      dragging: { enable: vi.fn(), disable: vi.fn() },
    })),
    tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    divIcon: vi.fn(() => ({})),
    marker: vi.fn(() => ({
      setLatLng: vi.fn(),
      getLatLng: vi.fn(() => ({ lat: 17.5, lng: -88.2 })),
      remove: vi.fn(),
      addTo: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    })),
    latLngBounds: vi.fn(() => ({})),
    circle: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), remove: vi.fn(), getBounds: vi.fn(() => ({})) })),
    Marker: { prototype: { options: {} as Record<string, unknown> } },
  },
}));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  apiPost.mockClear();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** See checkout/page.test.tsx's own copy of this helper for the full BMPL-380/MDF-511 rationale. */
async function waitForNoPulse(el: HTMLElement, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (el.innerHTML.includes('animate-pulse')) {
    if (Date.now() >= deadline) {
      throw new Error(`waitForNoPulse: "animate-pulse" never cleared within ${timeoutMs}ms`);
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const DEPARTURE: Departure = {
  id: 'trip_1',
  reference: 'TRP-1',
  status: 'SCHEDULED',
  scheduledDepartureAt: new Date('2026-12-01T12:00:00Z').toISOString(),
  scheduledArrivalAt: null,
  route: {
    name: 'Belize City — San Ignacio',
    originDistrict: 'BELIZE',
    originCity: 'Belize City',
    destinationDistrict: 'CAYO',
    destinationCity: 'San Ignacio',
    scheduleNote: null,
    durationMinutes: 120,
  },
  operator: 'Western Express',
  baseFareMinor: 1000,
  fareConfigured: true,
  seatCapacity: 20,
  seatsConfirmed: 0,
};

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<DepartureCard departure={DEPARTURE} onBooked={async () => {}} />);
  });
}

function openForm() {
  const open = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Request seats');
  act(() => open!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function submitButton(): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Send request') as HTMLButtonElement;
}

function checkbox(label: string): HTMLInputElement {
  const el = Array.from(container!.querySelectorAll('label')).find((l) => l.textContent?.trim() === label);
  return el!.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

describe('BookingForm (MDF-549): pickup/dropoff are optional, off by default', () => {
  it('sends only {tripId, seats} when neither pickup nor dropoff is added -- unchanged default behaviour', async () => {
    mount();
    openForm();

    await act(async () => {
      submitButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(apiPost).toHaveBeenCalledWith('/passenger/bookings', { tripId: 'trip_1', seats: 1 });
  });

  it('checking "Add a pickup location" reveals a real AddressField, and blocks submit until it is complete', async () => {
    mount();
    openForm();

    act(() => {
      checkbox('Pick me up somewhere other than the route’s stop').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await waitForNoPulse(container!);

    expect(container!.querySelector('fieldset[aria-label="Pickup location"]')).toBeTruthy();
    // No district chosen yet -- addressGap blocks submission, same rule as
    // checkout's own delivery address (MDF-485).
    expect(submitButton().disabled).toBe(true);
  });

  it('both pickup and dropoff render together once both are checked -- never a one-at-a-time wizard', async () => {
    mount();
    openForm();

    act(() => {
      checkbox('Pick me up somewhere other than the route’s stop').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      checkbox('Drop me off somewhere other than the route’s stop').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await waitForNoPulse(container!);

    expect(container!.querySelector('fieldset[aria-label="Pickup location"]')).toBeTruthy();
    expect(container!.querySelector('fieldset[aria-label="Destination"]')).toBeTruthy();
  });

  it('a completed pickup (typed, no pin) is included in the payload; dropoff stays omitted', async () => {
    mount();
    openForm();

    act(() => {
      checkbox('Pick me up somewhere other than the route’s stop').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await waitForNoPulse(container!);

    const pickupFieldset = container!.querySelector('fieldset[aria-label="Pickup location"]') as HTMLElement;
    // Default method is PIN; switch to TYPED so a street satisfies
    // isLocatable with no map interaction needed.
    const methodSelect = pickupFieldset.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      methodSelect.value = 'TYPED';
      methodSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    const streetInput = pickupFieldset.querySelector('input[autocomplete="address-line1"]') as HTMLInputElement;
    const cityInput = pickupFieldset.querySelector('input[autocomplete="address-level2"]') as HTMLInputElement;
    const districtSelect = Array.from(pickupFieldset.querySelectorAll('select')).find((s) => s !== methodSelect) as HTMLSelectElement;

    act(() => {
      nativeInputValueSetter.call(streetInput, '12 Front St');
      streetInput.dispatchEvent(new Event('input', { bubbles: true }));
      nativeInputValueSetter.call(cityInput, 'Belize City');
      cityInput.dispatchEvent(new Event('input', { bubbles: true }));
      districtSelect.value = 'BELIZE';
      districtSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    expect(submitButton().disabled).toBe(false);

    await act(async () => {
      submitButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(apiPost).toHaveBeenCalledWith('/passenger/bookings', {
      tripId: 'trip_1',
      seats: 1,
      pickup: {
        latitude: null,
        longitude: null,
        district: 'BELIZE',
        city: 'Belize City',
        address: '12 Front St',
      },
    });
  });
});

describe('BookingForm (MDF-554): the fare is restated where the rider commits', () => {
  it('shows the identical "Fare BZ$..." figure inside the request panel, next to the submit control', async () => {
    mount();
    openForm();

    const fareLines = Array.from(container!.querySelectorAll('p')).filter((p) => p.textContent === 'Fare BZ$10.00');
    // One on the card (browse time), one inside the now-open panel (commit time).
    expect(fareLines.length).toBe(2);
  });

  it('never multiplies by seats, never shows a total, however many seats are requested', async () => {
    mount();
    openForm();

    const seatsInput = container!.querySelector('input[type="number"]') as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      nativeInputValueSetter.call(seatsInput, '4');
      seatsInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container!.textContent).toContain('Fare BZ$10.00');
    expect(container!.textContent).not.toMatch(/BZ\$40\.00|per seat|per booking|[Tt]otal/);
  });
});

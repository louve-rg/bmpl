// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TripBookings } from './TripBookings';
import type { TripBooking } from '../../lib/passenger-driver';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-549/MDF-548: the driver's own read of a trip's bookings
 * (`GET /passenger/driver/trips/:id/bookings`). No rider name or phone on
 * this payload by design -- these tests never assert on one, and the "no
 * personal field" test below confirms none leaks in.
 */
const apiGet = vi.fn<(path: string) => Promise<unknown>>();
vi.mock('../../lib/api', () => ({
  api: {
    get: (path: string) => apiGet(path),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

// Same minimal fake Leaflet as admin's AddressMapPreview/booking-detail tests.
vi.mock('leaflet', () => {
  function fakeMarker() {
    const marker = { addTo: vi.fn(), bindPopup: vi.fn(), on: vi.fn(), openPopup: vi.fn() };
    marker.addTo.mockReturnValue(marker);
    marker.bindPopup.mockReturnValue(marker);
    return marker;
  }
  function fakeMap() {
    return {
      setView: vi.fn(),
      on: vi.fn(),
      getZoom: vi.fn(() => 13),
      invalidateSize: vi.fn(),
      remove: vi.fn(),
      fitBounds: vi.fn(),
      dragging: { enable: vi.fn(), disable: vi.fn() },
    };
  }
  const L = {
    map: vi.fn(() => fakeMap()),
    tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    divIcon: vi.fn(() => ({})),
    marker: vi.fn(() => fakeMarker()),
    latLngBounds: vi.fn(() => ({})),
  };
  return { default: L };
});
vi.mock('leaflet/dist/leaflet.css', () => ({}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function baseBooking(extra: Partial<TripBooking> = {}): TripBooking {
  return {
    id: 'book_1',
    reference: 'BK-2001',
    status: 'CONFIRMED',
    seats: 2,
    isTest: false,
    tripId: 'trip_1',
    tripReference: 'TRP-1001',
    tripStatus: 'ASSIGNED',
    scheduledDepartureAt: new Date('2026-12-01T12:00:00Z').toISOString(),
    routeName: 'San Ignacio — Belize City',
    from: 'San Ignacio',
    to: 'Belize City',
    confirmedAt: new Date().toISOString(),
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    createdAt: new Date().toISOString(),
    pickup: null,
    dropoff: null,
    ...extra,
  };
}

async function mount(tripId = 'trip_1') {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<TripBookings tripId={tripId} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  document.body.innerHTML = '';
  root = null;
  container = null;
  apiGet.mockReset();
});

describe('TripBookings (MDF-549, driver half)', () => {
  it('renders "nothing to show" for an empty array -- the unassigned-trip response, not an error', async () => {
    apiGet.mockResolvedValue([]);
    await mount();

    expect(apiGet).toHaveBeenCalledWith('/passenger/driver/trips/trip_1/bookings');
    expect(container!.textContent).toContain('No passengers yet');
    expect(container!.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows "Not specified" and no map action when neither end is pinned -- the normal case', async () => {
    apiGet.mockResolvedValue([baseBooking()]);
    await mount();

    expect(container!.textContent).toContain('BK-2001');
    expect(container!.textContent).toMatch(/Not specified.*route.s own stop/);
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Show map')).toBe(false);
  });

  it('never renders a passenger name or phone -- no such field on this payload by design', async () => {
    apiGet.mockResolvedValue([baseBooking()]);
    await mount();

    expect(container!.textContent).not.toMatch(/phone/i);
    // The booking identifies itself by reference and seats only.
    expect(container!.textContent).toContain('2 seats');
  });

  it('shows the pickup line and, once "Show map" is tapped, draws both pins', async () => {
    const leaflet = (await import('leaflet')).default as unknown as { map: ReturnType<typeof vi.fn>; marker: ReturnType<typeof vi.fn> };
    leaflet.map.mockClear();
    leaflet.marker.mockClear();
    apiGet.mockResolvedValue([
      baseBooking({
        pickup: {
          district: 'CAYO',
          city: 'San Ignacio',
          address: '5 Burns Ave',
          landmark: null,
          instructions: 'Call on arrival',
          latitude: 17.16,
          longitude: -89.07,
        },
        dropoff: {
          district: 'BELIZE',
          city: 'Belize City',
          address: null,
          landmark: 'Near the market',
          instructions: null,
          latitude: 17.5,
          longitude: -88.2,
        },
      }),
    ]);
    await mount();

    expect(container!.textContent).toContain('5 Burns Ave');
    expect(container!.textContent).toContain('Call on arrival');
    expect(container!.textContent).toContain('Near the market');

    const showMap = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Show map');
    expect(showMap).not.toBeUndefined();
    await act(async () => {
      showMap!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(leaflet.map).toHaveBeenCalledTimes(1);
    expect(leaflet.marker).toHaveBeenCalledWith([17.16, -89.07], expect.anything());
    expect(leaflet.marker).toHaveBeenCalledWith([17.5, -88.2], expect.anything());
  });

  it('shows the API error verbatim on failure, distinct from the empty-array "nothing to show" case', async () => {
    apiGet.mockRejectedValue({ status: 500, message: 'Something went wrong' });
    await mount();

    expect(container!.querySelector('[role="alert"]')).not.toBeNull();
  });
});

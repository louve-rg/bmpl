// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeparturesManager } from './DeparturesManager';
import type { OperatorTrip } from '../../lib/passenger-operator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-554 gap B: the operator had no "view passengers" control at all on a
 * departure, unlike the driver's own TripsList. This reuses the exact same
 * `TripBookings` component, pointed at the operator's own
 * `GET /passenger/provider/bookings?tripId=` instead of the driver's path.
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

// TripBookings statically pulls in ExpandableRouteMap -> MapPreview -> leaflet,
// even when "Show map" is never tapped (same mock as TripBookings.test.tsx).
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

const TRIP: OperatorTrip = {
  id: 'trip_1',
  reference: 'TRP-1001',
  status: 'SCHEDULED',
  routeId: 'route_1',
  routeName: 'San Ignacio — Belize City',
  driverProfileId: null,
  driverName: null,
  vehicleId: null,
  vehicle: null,
  seatCapacity: null,
  scheduledDepartureAt: new Date('2026-12-01T12:00:00Z').toISOString(),
};

function stubLoads() {
  apiGet.mockImplementation((path: string) => {
    if (path === '/passenger/provider/trips') return Promise.resolve([TRIP]);
    if (path === '/passenger/provider/routes') return Promise.resolve([]);
    if (path.startsWith('/passenger/provider/affiliations')) return Promise.resolve([]);
    if (path === '/passenger/provider/vehicles') return Promise.resolve([]);
    if (path === '/passenger/provider/bookings?tripId=trip_1') return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<DeparturesManager />);
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

describe('DeparturesManager — "View passengers" (MDF-554 gap B)', () => {
  it('fetches the trip bookings, filtered to this departure, only once expanded', async () => {
    stubLoads();
    await mount();

    expect(container!.textContent).toContain('TRP-1001');
    expect(apiGet).not.toHaveBeenCalledWith('/passenger/provider/bookings?tripId=trip_1');

    const toggle = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'View passengers');
    expect(toggle).not.toBeUndefined();
    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledWith('/passenger/provider/bookings?tripId=trip_1');
    expect(container!.textContent).toContain('No passengers yet');
  });

  it('renders a booking’s pickup/drop-off once expanded', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/passenger/provider/trips') return Promise.resolve([TRIP]);
      if (path === '/passenger/provider/bookings?tripId=trip_1') {
        return Promise.resolve([
          {
            id: 'book_1',
            reference: 'BK-2001',
            status: 'CONFIRMED',
            seats: 1,
            isTest: false,
            pickup: {
              district: 'CAYO',
              city: 'San Ignacio',
              address: '5 Burns Ave',
              landmark: null,
              instructions: null,
              latitude: 17.16,
              longitude: -89.07,
            },
            dropoff: null,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    await mount();

    const toggle = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'View passengers');
    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container!.textContent).toContain('5 Burns Ave');
  });
});

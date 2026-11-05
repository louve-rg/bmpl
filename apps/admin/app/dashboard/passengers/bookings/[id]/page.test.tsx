// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-549, admin half. Fetches the single-booking endpoint Pam added on
 * `feat/passenger-api-booking-pins` (`GET admin/passengers/bookings/:id`,
 * plural "passengers" -- god's own correction of an earlier relayed
 * singular path).
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'book_1' }),
}));

// Same minimal fake Leaflet as orders/[id]/page.test.tsx (MDF-538).
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

const { default: AdminBookingDetailPage } = await import('./page');

function baseBooking(extra: Record<string, unknown> = {}) {
  return {
    id: 'book_1',
    reference: 'BK-2001',
    status: 'REQUESTED' as const,
    seats: 2,
    isTest: false,
    tripReference: 'TRP-1001',
    tripStatus: 'SCHEDULED',
    scheduledDepartureAt: new Date('2026-12-01T12:00:00Z').toISOString(),
    routeName: 'San Ignacio — Belize City',
    from: 'San Ignacio',
    to: 'Belize City',
    passengerName: 'Jane Rider',
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Stubs the single-booking endpoint the page calls. `null` answers 404 — the not-found case. */
function stubFetch(booking: ReturnType<typeof baseBooking> | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/passengers/bookings/')) {
        return booking ? jsonResponse(200, booking) : jsonResponse(404, { message: 'Booking not found' });
      }
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<AdminBookingDetailPage />);
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
  vi.unstubAllGlobals();
});

describe('AdminBookingDetailPage (MDF-549)', () => {
  it('shows "Booking not found" when the endpoint 404s', async () => {
    stubFetch(null);
    await mount();
    expect(container!.textContent).toContain('Booking not found');
  });

  it('shows "Not specified" for pickup/drop-off, and no map, when neither is set -- the normal case for a scheduled-route booking', async () => {
    stubFetch(baseBooking());
    await mount();

    expect(container!.textContent).toContain('BK-2001');
    expect(container!.textContent).toContain('Jane Rider');
    expect(container!.textContent).toMatch(/Not specified.*route.s own stop/);
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Show map')).toBe(false);
  });

  it('shows the pickup address line and, once "Show map" is tapped, draws both pins', async () => {
    const leaflet = (await import('leaflet')).default as unknown as { map: ReturnType<typeof vi.fn>; marker: ReturnType<typeof vi.fn> };
    leaflet.map.mockClear();
    leaflet.marker.mockClear();
    stubFetch(
      baseBooking({
        pickupDistrict: 'CAYO',
        pickupCity: 'San Ignacio',
        pickupAddress: '5 Burns Ave',
        pickupLandmark: null,
        pickupInstructions: 'Call on arrival',
        pickupLatitude: 17.16,
        pickupLongitude: -89.07,
        dropoffDistrict: 'BELIZE',
        dropoffCity: 'Belize City',
        dropoffAddress: null,
        dropoffLandmark: 'Near the market',
        dropoffInstructions: null,
        dropoffLatitude: 17.5,
        dropoffLongitude: -88.2,
      }),
    );
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
});

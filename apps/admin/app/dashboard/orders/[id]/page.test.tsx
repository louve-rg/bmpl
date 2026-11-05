// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-354: staff could not see which of a vendor's locations fulfilled an
 * order anywhere in apps/admin — originLocationId was recorded (BMPL-175)
 * but never reached this screen. Same useParams-mock approach as the
 * logistics ops page test.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'order_1' }),
}));

// MDF-538: a minimal fake Leaflet, same shape as apps/web's map tests --
// only exercised by the pin-preview tests below. Every other test here has
// deliveryAddress: null and never imports 'leaflet' at all.
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

const { default: AdminOrderDetailPage } = await import('./page');

function baseOrder(originLocation: { id: string; label: string } | null) {
  return {
    id: 'order_1',
    orderNumber: 'ORD-ABC123',
    status: 'PENDING',
    itemCount: 1,
    subtotalMinor: 1000,
    deliveryFeeMinor: 0,
    totalMinor: 1000,
    currency: 'BZD',
    placedAt: new Date().toISOString(),
    customer: { name: 'Jane Customer', email: 'jane@example.bz' },
    deliveryAddress: null,
    vendorOrders: [
      {
        id: 'vo_1',
        orderNumber: 'ORD-ABC123-V1',
        status: 'PENDING',
        deliveryMethod: 'PICKUP' as const,
        delivery: null,
        customerNotes: null,
        itemCount: 1,
        subtotalMinor: 1000,
        vendor: { businessName: 'Ambergris Grill' },
        items: [{ productTitle: 'Widget', variantTitle: null, sku: 'W-1', unitPriceMinor: 1000, quantity: 1, subtotalMinor: 1000 }],
        originLocation,
      },
    ],
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(order: ReturnType<typeof baseOrder>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/orders/order_1')) return jsonResponse(200, order);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<AdminOrderDetailPage />);
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

describe('AdminOrderDetailPage — fulfilment origin (BMPL-354)', () => {
  it('shows which location fulfilled the order when one was recorded', async () => {
    stubFetch(baseOrder({ id: 'loc_1', label: 'Front Counter' }));
    await mount();
    expect(container!.textContent).toContain('Fulfilled from');
    expect(container!.textContent).toContain('Front Counter');
  });

  it('shows nothing — not an error — for a historical order with no recorded origin', async () => {
    stubFetch(baseOrder(null));
    await mount();
    expect(container!.textContent).not.toContain('Fulfilled from');
    // The rest of the order still renders fine around the absence.
    expect(container!.textContent).toContain('Ambergris Grill');
  });
});

describe('AdminOrderDetailPage — delivery address map preview (MDF-538, owner section 8)', () => {
  function withDeliveryAddress(deliveryAddress: unknown) {
    return { ...baseOrder(null), deliveryAddress } as unknown as ReturnType<typeof baseOrder>;
  }

  it('shows no map and no "Show map" control for a pin-less address -- the normal case today', async () => {
    stubFetch(
      withDeliveryAddress({
        fullName: 'Jane Customer',
        phone: '+501 600 0000',
        addressLine1: '12 Front St',
        addressLine2: null,
        city: 'Belize City',
        district: 'BELIZE',
        country: 'BZ',
      }),
    );
    await mount();

    expect(container!.textContent).toContain('12 Front St');
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Show map')).toBe(false);
  });

  it('draws the pin, against the written address, once "Show map" is tapped', async () => {
    const leaflet = (await import('leaflet')).default as unknown as { map: ReturnType<typeof vi.fn>; marker: ReturnType<typeof vi.fn> };
    leaflet.map.mockClear();
    leaflet.marker.mockClear();
    stubFetch(
      withDeliveryAddress({
        fullName: 'Jane Customer',
        phone: '+501 600 0000',
        addressLine1: null,
        addressLine2: null,
        city: 'Belize City',
        district: 'BELIZE',
        country: 'BZ',
        latitude: 17.5,
        longitude: -88.2,
      }),
    );
    await mount();

    const showMap = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Show map');
    expect(showMap).not.toBeUndefined();
    await act(async () => {
      showMap!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(leaflet.map).toHaveBeenCalledTimes(1);
    expect(leaflet.marker).toHaveBeenCalledWith([17.5, -88.2], expect.anything());
  });
});

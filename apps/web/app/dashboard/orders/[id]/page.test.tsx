// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VendorOrderDetailPage from './page';

// Same convention as LocationPicker.test.tsx / shipments/new/page.test.tsx --
// no @testing-library/react dependency in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'vo_1' }),
}));

/**
 * MDF-538 (owner section 5): the vendor already sees this exact written
 * address unconditionally today (Jim live-confirmed it) -- a map of the
 * same address is the same information presented better, not new exposure.
 * Same fake Leaflet shape as apps/web's other map tests.
 */
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

function baseVendorOrder(deliveryAddress: unknown) {
  return {
    id: 'vo_1',
    orderNumber: 'ORD-ABC123-V1',
    status: 'PENDING',
    deliveryMethod: 'DELIVERY' as const,
    delivery: { status: 'PENDING', feeMinor: 0, freeApplied: true, estimate: null, instructions: null },
    customerNotes: null,
    itemCount: 1,
    subtotalMinor: 1000,
    currency: 'BZD',
    vendor: { businessName: 'Ambergris Grill', slug: 'ambergris-grill' },
    items: [],
    parentOrderNumber: 'ORD-ABC123',
    placedAt: new Date().toISOString(),
    customerName: 'Jane Customer',
    deliveryAddress,
  };
}

const apiGet = vi.fn();
vi.mock('../../../../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  apiGet.mockReset();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<VendorOrderDetailPage />);
  });
}

describe('VendorOrderDetailPage — delivery address map preview (MDF-538, owner section 5)', () => {
  it('shows no map for a written address with no pin -- the vendor sees exactly what it sees today, nothing new', async () => {
    apiGet.mockResolvedValue(
      baseVendorOrder({
        fullName: 'Jane Customer',
        phone: '+501 600 0000',
        addressLine1: '12 Front St',
        addressLine2: null,
        city: 'Belize City',
        district: 'BELIZE',
        country: 'BZ',
      }),
    );
    mount();
    await flush();

    expect(container!.textContent).toContain('12 Front St');
    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Show map')).toBe(false);
  });

  it('draws the pin, against the same written address, for a pin-only delivery -- the case this phase exists for', async () => {
    const leaflet = (await import('leaflet')).default as unknown as { map: ReturnType<typeof vi.fn>; marker: ReturnType<typeof vi.fn> };
    apiGet.mockResolvedValue(
      baseVendorOrder({
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
    mount();
    await flush();

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

  it('shows no map at all for a pickup order, which has no delivery address to pin', async () => {
    apiGet.mockResolvedValue({ ...baseVendorOrder(null), deliveryMethod: 'PICKUP' as const, delivery: null });
    mount();
    await flush();

    expect(Array.from(container!.querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Show map')).toBe(false);
  });
});

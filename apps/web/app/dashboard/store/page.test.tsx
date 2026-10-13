// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// react-dom's act() checks this flag; see LocationPicker.test.tsx / the
// driver shipping job page test for the same convention (no
// @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// LocationsSection renders LocationPicker, which touches real Leaflet —
// real Leaflet needs a real browser canvas/viewport jsdom does not
// provide (same minimal fake as LocationPicker.test.tsx / the driver
// shipping job page test).
vi.mock('leaflet', () => {
  function fakeMap() {
    return {
      setView: vi.fn(),
      on: vi.fn(),
      getZoom: vi.fn(() => 13),
      invalidateSize: vi.fn(),
      remove: vi.fn(),
      fitBounds: vi.fn(),
    };
  }
  const L = {
    map: vi.fn(() => fakeMap()),
    tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    divIcon: vi.fn(() => ({})),
    marker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis(), remove: vi.fn() })),
    latLngBounds: vi.fn(() => ({})),
  };
  return { default: L };
});
vi.mock('leaflet/dist/leaflet.css', () => ({}));

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiPut = vi.fn();
const apiDel = vi.fn();
vi.mock('../../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
    put: (...args: unknown[]) => apiPut(...args),
    del: (...args: unknown[]) => apiDel(...args),
  },
}));

const { default: StorePage } = await import('./page');

function store(overrides: { approvalStatus?: string; storeStatus?: string } = {}) {
  return {
    profile: {
      id: 'vendor1',
      businessName: 'Belize Snacks',
      slug: 'belize-snacks',
      description: null,
      contactEmail: 'owner@example.bz',
      contactPhone: null,
      website: null,
      approvalStatus: overrides.approvalStatus ?? 'APPROVED',
      storeStatus: overrides.storeStatus ?? 'CLOSED',
      rejectionReason: null,
      logoUrl: null,
      bannerUrl: null,
    },
    settings: { pickupEnabled: true, deliveryEnabled: true, vacationMode: false, hideOutOfStock: false, minimumOrderMinor: null },
    locations: [],
    openingHours: [],
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  apiGet.mockReset();
  apiPost.mockReset();
  apiPatch.mockReset();
  apiPut.mockReset();
  apiDel.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<StorePage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * Owner ruling (god, conv-mission-2026-10-13): a newly approved vendor with
 * a closed store must clearly see it, with an action to open it where
 * authorized. A vendor can already open their own store (PATCH
 * /vendor/profile accepts storeStatus with the vendor's own session) — the
 * gap was only that this screen never surfaced it clearly. Surfacing only:
 * no default change, no automatic opening.
 */
describe('StorePage — closed-store surfacing (owner ruling)', () => {
  it('clearly shows the store is not accepting orders, with an action to open it, once approved and closed', async () => {
    apiGet.mockResolvedValue(store({ approvalStatus: 'APPROVED', storeStatus: 'CLOSED' }));
    const el = await mount();

    expect(el.textContent).toContain('Your store is not accepting orders');
    const openButton = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Open my store');
    expect(openButton).toBeTruthy();
  });

  it('clicking "Open my store" calls the existing PATCH /vendor/profile with storeStatus OPEN, nothing else', async () => {
    apiGet.mockResolvedValue(store({ approvalStatus: 'APPROVED', storeStatus: 'CLOSED' }));
    apiPatch.mockResolvedValue(undefined);
    const el = await mount();

    const openButton = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Open my store')!;
    await act(async () => {
      openButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiPatch).toHaveBeenCalledWith('/vendor/profile', { storeStatus: 'OPEN' });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('shows nothing extra once the store is open', async () => {
    apiGet.mockResolvedValue(store({ approvalStatus: 'APPROVED', storeStatus: 'OPEN' }));
    const el = await mount();

    expect(el.textContent).not.toContain('Your store is not accepting orders');
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent === 'Open my store')).toBe(false);
  });

  it('does not show the closed-store warning before the store is even approved — this is surfacing, not a default change', async () => {
    apiGet.mockResolvedValue(store({ approvalStatus: 'PENDING', storeStatus: 'CLOSED' }));
    const el = await mount();

    expect(el.textContent).not.toContain('Your store is not accepting orders');
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent === 'Open my store')).toBe(false);
  });
});

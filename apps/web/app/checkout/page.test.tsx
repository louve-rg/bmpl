// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CheckoutPage from './page';
import type { CartView } from '../../lib/cart';
import type { WalletSummary } from '../../lib/wallet';

// react-dom's act() checks this flag; see LocationPicker.test.tsx /
// ExceptionResolution.test.tsx for the same convention (no
// @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A STABLE object — the real next/navigation useRouter() returns the same
// router reference across renders. A mock returning a fresh object every
// call breaks checkout's own `useCallback(load, [router])` /
// `useEffect(..., [load])` chain (load's identity changes every render, so
// the effect re-fires every render, forever) — an infinite render loop.
//
// BMPL-380, negative control (god's ruling): this instability, not
// next/dynamic, turned out to be the ACTUAL cause of the original mount
// hang. With this object stabilized, CheckoutPage mounts its real,
// unmocked `next/dynamic()`-wrapped AddressField/LocationPicker just
// fine — confirmed by disabling the global next/dynamic mock entirely and
// re-running this file (passed, 3/3 deterministic), then reproducing the
// hang again with only this one object made unstable (next/dynamic still
// real, untouched). So BMPL-380's original premise — that next/dynamic
// itself cannot mount under Vitest — was wrong; the global mock has been
// removed. Left here as a landmine warning: an unstable router mock
// produces a hang that presents identically to a real bundler-dependency
// failure, and the only way to tell them apart is a control like this one,
// not a guess from the symptom.
const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const CART: CartView = {
  id: 'cart_1',
  currency: 'BZD',
  itemCount: 1,
  distinctItemCount: 1,
  subtotalMinor: 2500,
  hasPriceChanges: false,
  hasUnavailableItems: false,
  updatedAt: new Date().toISOString(),
  vendors: [
    {
      vendorProfileId: 'vendor_1',
      slug: 'vendor-1',
      businessName: 'Corner Store',
      storeStatus: 'ACTIVE',
      subtotalMinor: 2500,
      itemCount: 1,
      items: [
        {
          id: 'item_1',
          productId: 'prod_1',
          variantId: null,
          title: 'Mango Jam',
          slug: 'mango-jam',
          variantLabel: null,
          sku: null,
          imageUrl: null,
          currency: 'BZD',
          quantity: 1,
          unitPriceMinor: 2500,
          unitPriceMinorSnapshot: 2500,
          priceChanged: false,
          lineSubtotalMinor: 2500,
          available: 10,
          inStock: true,
          issues: [],
          purchasable: true,
        },
      ],
    },
  ],
};

const WALLET: WalletSummary = {
  currency: 'BZD',
  availableMinor: 10000,
  onHoldMinor: 0,
  totalMinor: 10000,
  status: 'ACTIVE',
  exists: true,
};

const QUOTE = {
  district: 'BELIZE',
  vendors: [
    {
      vendorProfileId: 'vendor_1',
      businessName: 'Corner Store',
      deliveryMethod: 'DELIVERY',
      deliverable: true,
      reason: null,
      feeMinor: 500,
      freeApplied: false,
      estimate: null,
      minimumOrderMinor: null,
    },
  ],
  subtotalMinor: 2500,
  deliveryFeeMinor: 500,
  totalMinor: 3000,
};

const apiGet = vi.fn((path: string) => {
  if (path === '/cart') return Promise.resolve(CART);
  if (path === '/wallet') return Promise.resolve(WALLET);
  return Promise.resolve(null);
});
const apiPost = vi.fn((path: string, _body?: unknown) => {
  if (path === '/checkout/delivery-quote') return Promise.resolve(QUOTE);
  return Promise.resolve(null);
});
vi.mock('../../lib/api', () => ({
  api: {
    get: (...args: [string]) => apiGet(...args),
    post: (...args: [string, unknown?]) => apiPost(...args),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

// Real `leaflet` needs a real browser canvas/viewport jsdom does not
// provide — same minimal fake as LocationPicker.test.tsx. AddressField's
// LocationPicker only mounts once a vendor is switched to DELIVERY below.
vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(() => ({ setView: vi.fn(), on: vi.fn(), getZoom: vi.fn(() => 13), invalidateSize: vi.fn(), remove: vi.fn(), fitBounds: vi.fn() })),
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
  apiGet.mockClear();
  apiPost.mockClear();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * BMPL-380: the REAL `next/dynamic()` resolves `AddressField`'s lazy
 * `LocationPicker` via a genuine dynamic `import()`, same as it would in
 * production. That settles on a real timer tick, not a plain microtask —
 * unlike the rest of this file's state updates, a fixed small number of
 * `await Promise.resolve()`s is not reliably enough to also clear it. Poll
 * instead of guessing a tick count, the same way LocationPicker.test.tsx's
 * own `flush()` only had to clear one such layer; this one clears two
 * (dynamic()'s own loader, then LocationPicker's own `import('leaflet')`).
 */
async function waitForNoPulse(el: HTMLElement, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    if (!el.innerHTML.includes('animate-pulse')) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

function findByText(el: HTMLElement, tag: string, text: string) {
  return Array.from(el.querySelectorAll(tag)).find((n) => n.textContent === text) ?? null;
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CheckoutPage />);
  });
}

/**
 * This is the test #287 (BMPL-350) had to ship without: CheckoutPage composes
 * AddressField, which wraps its LocationPicker in a real, unmocked
 * `next/dynamic()`. Before BMPL-380, mounting this page under Vitest hung
 * forever — not a thrown error, so nothing to catch or mock around.
 * BMPL-350 traced that hang to `next/dynamic` itself; BMPL-380's own
 * negative control (see the `router` comment above) found the actual
 * cause was an unstable `next/navigation` `useRouter()` test mock, not
 * `next/dynamic` — which mounts here exactly as written, no special
 * handling needed beyond the polling flush below. These tests exist to
 * prove that mount stays fixed, not to re-litigate checkout's own business
 * logic (covered elsewhere).
 */
describe('CheckoutPage mounts its real next/dynamic-wrapped AddressField (BMPL-380)', () => {
  it('loads the cart, and switching a vendor to Delivery reveals the real map — not an eternal loading placeholder', async () => {
    mount();
    await flush();

    expect(findByText(container!, 'span', 'Corner Store')).toBeTruthy();

    // One vendor in cart -> exactly one Pickup/Delivery radio pair.
    const radios = Array.from(container!.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    const [, delivery] = radios;

    await act(async () => {
      delivery!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      delivery!.checked = true;
      delivery!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    expect(findByText(container!, 'legend', 'Delivery address & contact')).toBeTruthy();

    await waitForNoPulse(container!);

    expect(container!.querySelectorAll('[role="application"]')).toHaveLength(1);
  });
}, 15000);

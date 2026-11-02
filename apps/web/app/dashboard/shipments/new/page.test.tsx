// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewShipmentPage from './page';

// react-dom's act() checks this flag; see checkout/page.test.tsx /
// LocationPicker.test.tsx for the same convention (no
// @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

// Only `quote` and `create` matter to these tests. Mocking lib/api (rather
// than lib/shipping/lib/wallet) reaches both in one place, because
// shippingApi/walletApi are thin wrappers over `api.get`/`api.post` -- and it
// also gives the address form's own real calls (geocode, saved addresses) a
// quiet, harmless default, the same approach checkout/page.test.tsx uses for
// /cart, /wallet and /checkout/delivery-quote.
const quoteMock = vi.fn();
const createMock = vi.fn();
quoteMock.mockResolvedValue({
  available: true,
  service: 'DOOR_TO_DOOR',
  serviceLabel: 'Door to door',
  serviceDescription: 'We collect and deliver.',
  totalMinor: 5000,
  transportMinutes: 60,
  explanation: 'Collected and delivered by road.',
  requestedDate: '2026-11-03',
  pricingIncomplete: false,
  pricingNote: null,
  legs: [{ sequence: 1, kind: 'DIRECT', mode: 'LAND', modeLabel: 'Road', description: 'Door to door by road', priceMinor: 5000, durationMinutes: 60 }],
});

const WALLET = { currency: 'BZD', availableMinor: 100000, onHoldMinor: 0, totalMinor: 100000, status: 'ACTIVE', exists: true };

const apiGet = vi.fn((path: string) => {
  if (path === '/shipping/hubs') return Promise.resolve([]);
  if (path === '/shipping/modes') return Promise.resolve(['LAND']);
  if (path === '/wallet') return Promise.resolve(WALLET);
  return Promise.resolve(null);
});
const apiPost = vi.fn((path: string, body?: unknown) => {
  if (path === '/shipping/quote') return quoteMock(body);
  if (path === '/shipping') return createMock(body);
  return Promise.resolve(null);
});
vi.mock('../../../../lib/api', () => ({
  api: {
    get: (...args: [string]) => apiGet(...args),
    post: (...args: [string, unknown?]) => apiPost(...args),
    patch: vi.fn(),
    del: vi.fn(),
    upload: vi.fn(),
  },
}));

// Real `leaflet` needs a real browser canvas/viewport jsdom does not
// provide -- same minimal fake as checkout/page.test.tsx. This page mounts
// two LocationPickers (origin + destination AddressField, both DOOR for the
// default DOOR_TO_DOOR service), never more than one of a pair expanded at
// once, same shape checkout's own single map already proved safe.
vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(() => ({ setView: vi.fn(), on: vi.fn(), getZoom: vi.fn(() => 13), invalidateSize: vi.fn(), remove: vi.fn(), fitBounds: vi.fn(), dragging: { enable: vi.fn(), disable: vi.fn() } })),
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
  createMock.mockReset();
  router.push.mockClear();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Same shape as checkout/page.test.tsx's own waitForNoPulse: the real
// next/dynamic() loader and LocationPicker's own `import('leaflet')` both
// settle on a timer tick, not a plain microtask.
async function waitForNoPulse(el: HTMLElement, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    if (!el.innerHTML.includes('animate-pulse')) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<NewShipmentPage />);
  });
}

// Same convention as components/shipping/AvailabilityWindows.test.tsx: the
// prototype's native setter bypasses React's own value-tracker, so the
// follow-up event is seen as a real change rather than swallowed as a no-op.
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;

function setInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  act(() => {
    nativeSelectValueSetter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * Fills one endpoint's town + district -- enough for `quotable()` on the
 * default DOOR_TO_DOOR service, which needs both ends to have a town. The
 * fieldset is found by its `aria-label`, which FormCard sets to the heading
 * EndpointPicker passes it ("Collect from" / "Deliver to") -- the same
 * technique checkout/page.test.tsx uses to find AddressField's fieldset.
 */
function fillTownAndDistrict(root: HTMLElement, legend: string, city: string, district: string) {
  const fieldset = root.querySelector(`fieldset[aria-label="${legend}"]`);
  if (!fieldset) throw new Error(`no fieldset "${legend}"`);
  const cityInput = fieldset.querySelector<HTMLInputElement>('input[autocomplete="address-level2"]');
  if (!cityInput) throw new Error(`no city input under "${legend}"`);
  setInputValue(cityInput, city);
  const districtSelect = Array.from(fieldset.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === district));
  if (!districtSelect) throw new Error(`no district select under "${legend}"`);
  setSelectValue(districtSelect, district);
}

async function settleQuote() {
  // page.tsx debounces its quote request 400ms after the last form change.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 450));
  });
  await flush();
}

function findBookButton(root: HTMLElement): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => /book shipment/i.test(b.textContent ?? ''));
  if (!btn) throw new Error('book button not found');
  return btn;
}

/** Mounts, fills both endpoints, waits for a priced quote, and returns the
 *  now-enabled book button -- the shared setup both tests below need before
 *  they can exercise the submit guard itself. */
async function fillAndQuote(): Promise<HTMLButtonElement> {
  mount();
  await flush();
  await waitForNoPulse(container!);
  fillTownAndDistrict(container!, 'Collect from', 'Belize City', 'BELIZE');
  fillTownAndDistrict(container!, 'Deliver to', 'San Ignacio', 'CAYO');
  await settleQuote();
  const book = findBookButton(container!);
  expect(book.disabled).toBe(false);
  return book;
}

describe('NewShipmentPage submit guard (BMPL, dropped-connection double-charge fix)', () => {
  it('a second click synchronously following the first does not issue a second create call -- the customer is not charged twice', async () => {
    createMock.mockResolvedValue({ reference: 'BML-TEST0001' });
    const book = await fillAndQuote();

    // Both dispatched inside the same act() callback, before React commits
    // the `booking` state update from the first click -- the exact race
    // `submitInFlight` (page.tsx) exists to close. The `disabled` attribute
    // has not updated yet either way at this point, so this genuinely
    // exercises the ref, not the DOM's own disabled-click suppression.
    await act(async () => {
      book.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      book.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(createMock).toHaveBeenCalledTimes(1);
  }, 10000);

  it('a create call that rejects with no HTTP status (a dropped connection) shows the connection-lost message, never the generic one', async () => {
    createMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const book = await fillAndQuote();

    await act(async () => {
      book.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(container!.textContent).toContain('We lost the connection before we could confirm this booking');
    expect(container!.textContent).not.toContain('We could not book that shipment.');
  }, 10000);
});

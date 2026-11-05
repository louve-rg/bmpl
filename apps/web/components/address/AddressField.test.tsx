// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressField, emptyAddress, type AddressValue } from './AddressField';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Owner-reported (MDF-554): placed a door-to-door shipment request and
 * reported he "couldn't save any addresses from the form page." Source
 * audit found the shipment-submit path itself sound (see handoff), but this
 * component's "Save to my addresses" star affordance went silently inert —
 * disabled, with nothing on screen saying why — the instant the address
 * itself was incomplete. A customer who typed a label and clicked got
 * exactly what he described: no error, it just didn't go through. Pure
 * frontend, reproducible with no courier/lane/production data involved.
 */
const apiGet = vi.fn<(path: string) => Promise<unknown>>(() => Promise.resolve([]));
const apiPost = vi.fn<(path: string, body?: unknown) => Promise<unknown>>();
// `errorMessage` is kept real (via `importOriginal`) -- only `api` itself is
// faked. It's a pure function read by AddressField's own catch blocks; the
// component imports it from this same module, so a mock that dropped it
// would make every save-error assertion throw "not a function" instead of
// testing anything.
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    get: (path: string) => apiGet(path),
    post: (path: string, body?: unknown) => apiPost(path, body),
    patch: vi.fn(),
    del: vi.fn(),
  },
}));

// Real `leaflet` needs a real browser canvas/viewport jsdom does not provide —
// same minimal fake as checkout/page.test.tsx / LocationPicker.test.tsx.
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

/** Same polling wait as checkout/page.test.tsx — the real next/dynamic-wrapped LocationPicker settles on a timer tick, not a microtask. */
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

function Harness({ initial }: { initial: AddressValue }) {
  const [value, setValue] = useState(initial);
  return <AddressField value={value} onChange={setValue} heading="Collect from" />;
}

function mount(initial: AddressValue) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness initial={initial} />);
  });
}

function saveButton(): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find((b) =>
    b.textContent?.trim().startsWith('Save to my addresses'),
  ) as HTMLButtonElement;
}

function labelInput(): HTMLInputElement {
  return container!.querySelector('input[aria-label="Name for this saved address"]') as HTMLInputElement;
}

function typeInto(el: HTMLInputElement, text: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    nativeInputValueSetter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('AddressField — "Save to my addresses" (MDF-554, owner-reported)', () => {
  it('stays disabled with no nag before any label is typed, then explains exactly what is missing instead of staying silently inert', async () => {
    mount({ ...emptyAddress('TYPED'), fullName: 'Edward Flowers', phone: '501-600-1234' });
    await flush();
    await waitForNoPulse(container!);

    // Untouched -- disabled, and nothing scolds the customer before they've
    // shown any intent to save.
    expect(saveButton().disabled).toBe(true);
    expect(container!.textContent).not.toContain('Choose the district.');

    typeInto(labelInput(), 'Home');
    await flush();

    // Still disabled -- district/city/pin are all still missing -- but now
    // the form says so, the same sentence `addressGap` uses for the submit
    // path, not a second invented one.
    expect(saveButton().disabled).toBe(true);
    expect(container!.textContent).toContain('Choose the district.');
  });

  it('once the address is complete, Save enables, shows no gap text, and actually posts to /addresses', async () => {
    mount({
      ...emptyAddress('TYPED'),
      fullName: 'Edward Flowers',
      phone: '501-600-1234',
      addressLine1: '12 Queen Street',
      city: 'Belize City',
      district: 'BELIZE',
    });
    await flush();
    await waitForNoPulse(container!);

    typeInto(labelInput(), 'Home');
    await flush();

    expect(saveButton().disabled).toBe(false);
    expect(container!.textContent).not.toContain('Choose the district.');

    apiPost.mockResolvedValueOnce({ id: 'addr_1', label: 'Home' });
    await act(async () => {
      saveButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(apiPost).toHaveBeenCalledWith('/addresses', expect.objectContaining({ label: 'Home', city: 'Belize City' }));
  });
});

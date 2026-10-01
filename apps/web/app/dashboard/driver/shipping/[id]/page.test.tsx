// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// react-dom's act() checks this flag; see StorefrontView.test.tsx / LocationPicker.test.tsx
// for the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'job1' }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Same minimal fake as LocationPicker.test.tsx / the established precedent for
// a component that dynamically import()s leaflet inside a useEffect — a real
// browser dependency jsdom doesn't provide, mocked rather than loaded.
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
vi.mock('../../../../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

const { default: DriverShippingJobPage } = await import('./page');

function place(over: Partial<{ pinnedLocation: { latitude: number; longitude: number } | null }> = {}) {
  return {
    kind: 'ADDRESS' as const,
    name: 'Sender',
    phone: null,
    address: '1 Market Sq',
    area: 'Belize City',
    instructions: null,
    navigationUrl: null,
    pinnedLocation: null,
    ...over,
  };
}

function shippingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job1',
    jobKind: 'FIRST_MILE',
    reference: 'BML-ABCD2345',
    status: 'DRIVER_ACCEPTED',
    statusLabel: 'Accepted',
    nextActionLabel: 'Confirm pickup',
    modeLabel: 'Road',
    addressUnlocked: true,
    pickup: place({ pinnedLocation: { latitude: 17.5, longitude: -88.2 } }),
    dropoff: place({ pinnedLocation: { latitude: 17.6, longitude: -88.3 } }),
    routeStops: [place({ pinnedLocation: { latitude: 17.5, longitude: -88.2 } }), place({ pinnedLocation: { latitude: 17.6, longitude: -88.3 } })],
    parcel: { description: 'A box', pieces: 1, weightGrams: null },
    feeMinor: 2500,
    handoffCodeHeldBy: 'the recipient',
    offerExpiresAt: null,
    pinAttemptsRemaining: 5,
    ...overrides,
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
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<DriverShippingJobPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * BMPL-349/350: ShippingJob.routeStops is optional on the web type — web and
 * api deploy independently, so there is a real window where this GET returns
 * a 200 with the key simply not there yet. Proven with a real missing key
 * (JSON round-trip + delete), same technique as StorefrontView.test.tsx.
 */
describe('DriverShippingJobPage — route map (BMPL-349/350)', () => {
  it('renders the route map normally when routeStops has real pins', async () => {
    apiGet.mockResolvedValue(shippingJob());
    const el = await mount();
    expect(el.textContent).toContain('BML-ABCD2345');
  });

  it('does not crash when routeStops is missing from the wire entirely', async () => {
    const raw = JSON.parse(JSON.stringify(shippingJob())) as Record<string, unknown>;
    delete raw.routeStops;
    apiGet.mockResolvedValue(raw);

    let threw = false;
    try {
      await mount();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(container!.textContent).toContain('BML-ABCD2345');
  });
});

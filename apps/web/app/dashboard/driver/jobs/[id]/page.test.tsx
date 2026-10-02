// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// react-dom's act() checks this flag; see StorefrontView.test.tsx / LocationPicker.test.tsx
// for the same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A STABLE object — see BMPL-380: a useRouter() mock returning a fresh
// object every call can break a component's own useCallback/useEffect
// dependency chain into an infinite render loop that presents exactly like
// a hang. This page has no such chain today, but there is no reason to
// reintroduce the landmine in a new test file.
const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'job1' }),
  useRouter: () => router,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Same minimal fake as LocationPicker.test.tsx / the shipping driver job
// page's own test — a real browser dependency jsdom doesn't provide.
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
    marker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), bindPopup: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis(), remove: vi.fn() })),
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

vi.mock('../../../../../lib/uploads', () => ({ uploadFile: vi.fn() }));
vi.mock('../../../../../components/messaging/MessageButton', () => ({ MessageButton: () => null }));

const { default: DriverJobDetailPage } = await import('./page');
const leaflet = (await import('leaflet')).default as unknown as { marker: ReturnType<typeof vi.fn> };

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job1',
    status: 'DRIVER_OFFERED',
    statusLabel: 'Offered',
    orderNumber: 'ORD-1001',
    vendor: { businessName: 'Corner Store' },
    feeMinor: 500,
    deliveryAddress: { city: 'Belmopan', district: 'CAYO' },
    addressUnlocked: false,
    pinnedLocation: null,
    navigationUrl: null,
    pickupLocation: { label: 'Main counter', city: 'Belize City', district: 'BELIZE', pinnedLocation: { latitude: 17.5, longitude: -88.2 } },
    items: [],
    requiresPickupPin: false,
    requiresDeliveryPin: false,
    podPhotoUrls: [],
    timeline: [],
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
  leaflet.marker.mockClear();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<DriverJobDetailPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * MapPreview itself carries no `role="application"` marker (that is
 * LocationPicker's own attribute, a different component) — it is a plain
 * div, built imperatively by calling into Leaflet once its dynamic
 * `import('leaflet')` resolves. That resolves on a real timer tick, not a
 * plain microtask (same gotcha documented in BMPL-380), so the only
 * reliable "has it drawn yet" signal is the mocked `L.marker` call count
 * itself — poll that instead of guessing a tick count or inventing a DOM
 * attribute the real component doesn't have.
 */
async function waitForMarkers(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    if (leaflet.marker.mock.calls.length > 0) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

/**
 * Edward requirement 8, marketplace half (BMPL-390): /dashboard/driver/jobs/[id]
 * had zero map import before this — confirmed by grep, not inferred. These
 * tests prove the new ExpandableRouteMap wiring draws exactly what the
 * server-side pre-acceptance gate (delivery-core.service.ts) allows: the
 * vendor's pickup pin always, the customer's door pin only once accepted.
 */
describe('DriverJobDetailPage — marketplace route map (BMPL-390, Edward req 8)', () => {
  it('unaccepted: draws only the vendor pickup pin, never a guessed customer point', async () => {
    apiGet.mockResolvedValue(job());
    const el = await mount();

    expect(el.textContent).toContain('ORD-1001');
    expect(leaflet.marker).not.toHaveBeenCalled(); // map is lazy, behind "Show map"

    const showMap = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Show map');
    expect(showMap).toBeTruthy();
    await act(async () => {
      showMap!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitForMarkers();

    // Exactly one pin drawn, at the vendor's own coordinates — never a
    // guessed point for the withheld customer door.
    expect(leaflet.marker).toHaveBeenCalledTimes(1);
    expect(leaflet.marker).toHaveBeenCalledWith([17.5, -88.2], expect.anything());
    expect(el.textContent).toContain('Collect: Corner Store');
    expect(el.textContent).not.toContain('Deliver:');
    expect(el.textContent).toContain('The customer’s pin appears here once you accept this delivery.');
  });

  it('accepted: draws both pins, Collect then Deliver', async () => {
    apiGet.mockResolvedValue(
      job({
        status: 'DRIVER_ACCEPTED',
        statusLabel: 'Accepted',
        addressUnlocked: true,
        deliveryAddress: { fullName: 'Jane Doe', phone: '601-0000', addressLine1: '12 Main St', city: 'Belmopan', district: 'CAYO' },
        pinnedLocation: { latitude: 17.25, longitude: -88.77 },
        navigationUrl: 'https://maps.example/customer',
      }),
    );
    const el = await mount();

    const showMap = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Show map');
    await act(async () => {
      showMap!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitForMarkers();

    expect(leaflet.marker).toHaveBeenCalledTimes(2);
    expect(leaflet.marker).toHaveBeenCalledWith([17.5, -88.2], expect.anything());
    expect(leaflet.marker).toHaveBeenCalledWith([17.25, -88.77], expect.anything());
    expect(el.textContent).toContain('Collect: Corner Store');
    expect(el.textContent).toContain('Deliver: Jane Doe');
    expect(el.textContent).not.toContain('The customer’s pin appears here once you accept this delivery.');
  });

  it('no pickup location and not yet accepted: no map section renders at all (no pin to draw)', async () => {
    apiGet.mockResolvedValue(job({ pickupLocation: null }));
    const el = await mount();

    expect(el.textContent).not.toContain('On the map');
  });
});

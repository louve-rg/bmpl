// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-280: the shipment ops screen (BMPL-270) gates every operating control
 * — depart/arrive, handoff, flag-a-problem, record-collection — on the
 * single logistics.operate permission, five call sites in one file. useParams
 * is mocked (this page reads the shipment reference from the route), same
 * approach as the other useParams pages in this round.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ reference: 'SHP-1001' }),
}));

const { default: ShipmentOpsPage } = await import('./page');

const SHIPMENT = {
  id: 'ship_1',
  reference: 'SHP-1001',
  serviceLabel: 'Door to door',
  status: 'AWAITING_COLLECTION',
  statusLabel: 'Awaiting collection',
  isTest: false,
  endsAtHub: true,
  quotedTotalMinor: 4500,
  explanation: null,
  exceptionReason: null,
  cancelledAt: null,
  origin: { name: 'Belize City', address: '4 Market Sq', city: 'Belize City', district: 'BELIZE' },
  destination: { name: 'San Pedro Airstrip', address: null, city: 'San Pedro', district: 'BELIZE' },
  legs: [
    {
      id: 'leg_1',
      sequence: 1,
      kind: 'LINE_HAUL' as const,
      mode: 'AIR',
      modeLabel: 'Flight',
      status: 'READY',
      description: null,
      carrier: 'Tropic Air',
      carrierBookingRef: null,
      scheduleNote: null,
      departedAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      handoffReceivedByName: null,
      exceptionReason: null,
      originHub: { name: 'Belize City Airstrip' },
      destinationHub: { name: 'San Pedro Airstrip' },
    },
  ],
  custody: [],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(adminPermissions: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      if (url.includes('/api/admin/logistics/shipments/SHP-1001')) return jsonResponse(200, SHIPMENT);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<ShipmentOpsPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function buttonTexts(): string[] {
  return Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('ShipmentOpsPage — write affordances gated on logistics.operate (BMPL-280)', () => {
  it('a logistics.read-only reader sees no write affordance anywhere on the page', async () => {
    stubFetch(['logistics.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Record collection');
    expect(texts).not.toContain('Mark departed');
    expect(document.body.textContent).not.toMatch(/Report a problem with this leg/);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // Read-only report half: the shipment and leg facts are still information.
    expect(document.body.textContent).toMatch(/Waiting to be collected/);
    expect(document.body.textContent).toMatch(/Tropic Air/);
    expect(document.body.textContent).toMatch(/\$45\.00/);
  });

  it('a logistics.operate operator sees every write affordance', async () => {
    stubFetch(['logistics.operate']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Record collection');
    expect(texts).toContain('Mark departed');
    expect(document.body.textContent).toMatch(/Report a problem with this leg/);
  });
});

/**
 * BMPL-178/352 (Edward req 2): pickupPhotoUrls is optional on the web type —
 * web and api deploy independently, so a required field read unguarded is
 * how a screen crashes on the api side lagging behind a merge (BMPL-349).
 */
describe('ShipmentOpsPage — pickup photo (BMPL-178/352)', () => {
  it('shows the courier-attached pickup photo for its own leg', async () => {
    stubFetch(['logistics.read']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['logistics.read'] });
        if (url.includes('/api/admin/logistics/shipments/SHP-1001')) {
          return jsonResponse(200, {
            ...SHIPMENT,
            legs: [{ ...SHIPMENT.legs[0], pickupPhotoUrls: ['https://example.com/pickup.jpg'] }],
          });
        }
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    const imgs = Array.from(document.body.querySelectorAll('img'));
    expect(imgs.some((img) => img.getAttribute('src') === 'https://example.com/pickup.jpg')).toBe(true);
  });

  it('does not crash when pickupPhotoUrls is absent from the leg entirely', async () => {
    stubFetch(['logistics.read']);
    await mount();

    // SHIPMENT's own fixture leg carries no pickupPhotoUrls key at all — the
    // page rendered without throwing and the rest of the leg still shows.
    expect(document.body.textContent).toMatch(/Tropic Air/);
    expect(document.body.querySelectorAll('img[alt^="Pickup photo"]').length).toBe(0);
  });
});

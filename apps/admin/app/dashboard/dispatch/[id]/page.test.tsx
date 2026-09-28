// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-280: the dispatch detail screen (BMPL-270) gates three INDEPENDENT
 * permissions, not one boolean — deliveries.assign (Reassign),
 * deliveries.manage (Cancel delivery) and deliveries.verify (the whole PIN
 * panel). A reader holding one must see exactly that one control and not the
 * others; a test that only checked "someone with nothing sees nothing" would
 * pass on an implementation that collapsed all three into a single flag.
 *
 * The delivery fixture is ASSIGNED so both Reassign (deliveries.assign) and
 * Cancel delivery (deliveries.manage) are status-eligible at the same time,
 * letting both be asserted independently from one render.
 *
 * The PIN panel is a deliberate exception to "read-only info still renders":
 * PINs are sensitive, so the WHOLE "Verification PINs" section — including
 * its explanatory text, not just the reveal button — is gated on
 * deliveries.verify, unlike a hub's hours or a route's schedule, which a
 * reader is entitled to see as a fact. Not a defect; the other InfoCards
 * (order, address, payment, items, driver, timeline) carry no permission
 * check at all and are what the "still renders as text" assertion covers.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'delivery_1' }),
}));

const { default: DispatchDetailPage } = await import('./page');

const DELIVERY = {
  id: 'delivery_1',
  status: 'ASSIGNED',
  statusLabel: 'Assigned to driver',
  orderNumber: 'ORD-3001',
  vendorOrderNumber: 'VO-3001',
  vendor: { businessName: 'Corozal Corner Store', slug: 'corozal-corner' },
  orderStatus: 'PROCESSING',
  deliveryAddress: { fullName: 'Jordan Reyes', phone: '610-1111', district: 'COROZAL', city: 'Corozal Town', addressLine1: '12 Main St' },
  pickupLocation: { label: 'Corozal Corner Store', addressLine1: '4 Market Sq', city: 'Corozal Town', district: 'COROZAL' },
  recipientName: 'Jordan Reyes',
  timestamps: null,
  feeMinor: 700,
  items: [{ productTitle: 'Rice 5lb', variantTitle: null, quantity: 2 }],
  driver: { displayName: 'Marco Tut', ratingAverage: 4.8, completedDeliveries: 120 },
  vehicle: null,
  currentDriverEligibility: null,
  payment: { status: 'CAPTURED', amountMinor: 700, currency: 'BZD' },
  timeline: [],
  assignmentHistory: [],
  podPhotoUrls: null,
  createdAt: new Date().toISOString(),
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
      if (url.includes('/api/admin/deliveries/delivery_1')) return jsonResponse(200, DELIVERY);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<DispatchDetailPage />);
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

describe('DispatchDetailPage — three independent permissions (BMPL-280)', () => {
  it('a reader with none of the three permissions sees no write affordance, and the order facts still render', async () => {
    stubFetch(['deliveries.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts.some((t) => t === 'Reassign')).toBe(false);
    expect(texts.some((t) => t === 'Cancel delivery')).toBe(false);
    expect(texts.some((t) => t.includes('Reveal'))).toBe(false);
    expect(document.body.textContent).not.toMatch(/Verification PINs/);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // Read-only report half — none of these InfoCards carry any permission
    // check at all.
    expect(document.body.textContent).toMatch(/ORD-3001/);
    expect(document.body.textContent).toMatch(/Corozal Corner Store/);
    expect(document.body.textContent).toMatch(/Marco Tut/);
    expect(document.body.textContent).toMatch(/CAPTURED/);
  });

  it('deliveries.assign alone shows Reassign but not Cancel delivery or PIN reveal', async () => {
    stubFetch(['deliveries.assign']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Reassign');
    expect(texts.some((t) => t === 'Cancel delivery')).toBe(false);
    expect(document.body.textContent).not.toMatch(/Verification PINs/);
  });

  it('deliveries.manage alone shows Cancel delivery but not Reassign or PIN reveal', async () => {
    stubFetch(['deliveries.manage']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Cancel delivery');
    expect(texts.some((t) => t === 'Reassign')).toBe(false);
    expect(document.body.textContent).not.toMatch(/Verification PINs/);
  });

  it('deliveries.verify alone shows the PIN panel but neither Reassign nor Cancel delivery', async () => {
    stubFetch(['deliveries.verify']);
    await mount();

    expect(document.body.textContent).toMatch(/Verification PINs/);
    const texts = buttonTexts();
    expect(texts.some((t) => t.includes('Reveal'))).toBe(true);
    expect(texts.some((t) => t === 'Reassign')).toBe(false);
    expect(texts.some((t) => t === 'Cancel delivery')).toBe(false);
  });

  it('holding all three shows every write affordance', async () => {
    stubFetch(['deliveries.assign', 'deliveries.manage', 'deliveries.verify']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Reassign');
    expect(texts).toContain('Cancel delivery');
    expect(texts.some((t) => t.includes('Reveal'))).toBe(true);
  });
});

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

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// react-dom's act() checks this flag; see driver/shipping/[id]/page.test.tsx for the
// same convention (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'order1' }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../../../components/landing/Header', () => ({ Header: () => null }));
vi.mock('../../../components/landing/Footer', () => ({ Footer: () => null }));

const getOwn = vi.fn();
const pickupPin = vi.fn();
vi.mock('../../../lib/orders', () => ({
  ordersApi: {
    getOwn: (...args: unknown[]) => getOwn(...args),
    pickupPin: (...args: unknown[]) => pickupPin(...args),
  },
  money: (minor: number) => `$${(minor / 100).toFixed(2)}`,
}));

const forOrder = vi.fn();
vi.mock('../../../lib/payments', () => ({
  paymentsApi: { forOrder: (...args: unknown[]) => forOrder(...args) },
}));

const { default: OrderDetailPage } = await import('./page');

function vendorOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vo1',
    orderNumber: 'BML-VO-0001',
    status: 'PENDING',
    deliveryMethod: 'PICKUP',
    customerNotes: null,
    currency: 'BZD',
    itemCount: 1,
    subtotalMinor: 1000,
    vendor: { businessName: 'Corner Store', slug: 'corner-store' },
    items: [{ productTitle: 'A box', variantTitle: null, unitPriceMinor: 1000, quantity: 1, subtotalMinor: 1000, imageUrl: null }],
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order1',
    orderNumber: 'BML-ORD-0001',
    status: 'PENDING',
    currency: 'BZD',
    itemCount: 1,
    subtotalMinor: 1000,
    deliveryFeeMinor: 0,
    totalMinor: 1000,
    placedAt: new Date().toISOString(),
    deliveryAddress: null,
    vendorOrders: [vendorOrder()],
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
  getOwn.mockReset();
  pickupPin.mockReset();
  forOrder.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<OrderDetailPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * A customer with a PICKUP order previously saw nothing between placing the
 * order and the pickup code appearing: CustomerPickupCode renders nothing
 * outside READY_FOR_PICKUP/PICKED_UP, and the only status badge on this page
 * was bound to the top-level order.status, which never leaves PENDING for a
 * multi-vendor order. Fixed by reading vo.status for a per-vendor-order
 * badge, same as the vendor-facing order detail page already does
 * (OrderStatusBadge status={vo.status}, app/dashboard/orders/[id]/page.tsx).
 */
describe('OrderDetailPage — pickup order status is visible before the pickup code (customer pickup-status defect)', () => {
  it('shows the vendor-order\'s own status (PENDING) even though the pickup code has not appeared yet', async () => {
    getOwn.mockResolvedValue(order());
    pickupPin.mockResolvedValue({ vendorOrderId: 'vo1', status: 'PENDING', pickupPin: null, pickedUpAt: null });
    forOrder.mockRejectedValue(new Error('no payment record'));

    const el = await mount();

    expect(el.textContent).toContain('PENDING');
  });

  it('shows PREPARING once the store has started on it, still with no pickup code yet', async () => {
    getOwn.mockResolvedValue(order({ vendorOrders: [vendorOrder({ status: 'PREPARING' })] }));
    pickupPin.mockResolvedValue({ vendorOrderId: 'vo1', status: 'PREPARING', pickupPin: null, pickedUpAt: null });
    forOrder.mockRejectedValue(new Error('no payment record'));

    const el = await mount();

    expect(el.textContent).toContain('PREPARING');
  });

  it('shows READY FOR PICKUP alongside the actual pickup code once it is ready', async () => {
    getOwn.mockResolvedValue(order({ vendorOrders: [vendorOrder({ status: 'READY_FOR_PICKUP' })] }));
    pickupPin.mockResolvedValue({ vendorOrderId: 'vo1', status: 'READY_FOR_PICKUP', pickupPin: '4821', pickedUpAt: null });
    forOrder.mockRejectedValue(new Error('no payment record'));

    const el = await mount();

    expect(el.textContent).toContain('READY FOR PICKUP');
    expect(el.textContent).toContain('4821');
  });

  it('does not touch the top-level order status badge — still bound to order.status, not invented', async () => {
    getOwn.mockResolvedValue(order({ status: 'PENDING', vendorOrders: [vendorOrder({ status: 'READY_FOR_PICKUP' })] }));
    pickupPin.mockResolvedValue({ vendorOrderId: 'vo1', status: 'READY_FOR_PICKUP', pickupPin: '4821', pickedUpAt: null });
    forOrder.mockRejectedValue(new Error('no payment record'));

    const el = await mount();

    // Both a PENDING (top-level) and a READY FOR PICKUP (vendor-order) badge
    // are genuinely present at once — that is the real, honest state, not a
    // contradiction to resolve by inventing a new combined status.
    expect(el.textContent).toContain('PENDING');
    expect(el.textContent).toContain('READY FOR PICKUP');
  });
});

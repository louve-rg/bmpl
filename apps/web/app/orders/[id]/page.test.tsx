// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// react-dom's act() checks this flag; see driver/shipping/[id]/page.test.tsx /
// StorefrontView.test.tsx / LocationPicker.test.tsx for the same convention
// (no @testing-library/react dependency in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stable reference across renders, matching the real next/navigation hooks --
// the page's own load effect lists `router` as a dependency, and a fresh
// object literal on every call would refire it (and therefore re-fetch) on
// every re-render instead of once.
const mockRouter = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'order1' }),
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => window.location.pathname,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Page chrome, irrelevant to either suite below; the real Header needs
// window.matchMedia, which jsdom does not provide.
vi.mock('../../../components/landing/Header', () => ({ Header: () => null }));
vi.mock('../../../components/landing/Footer', () => ({ Footer: () => null }));

const getOwn = vi.fn();
const cancel = vi.fn();
const pickupPin = vi.fn();
vi.mock('../../../lib/orders', () => ({
  money: (minor: number) => `$${(minor / 100).toFixed(2)}`,
  ordersApi: {
    getOwn: (...args: unknown[]) => getOwn(...args),
    cancel: (...args: unknown[]) => cancel(...args),
    pickupPin: (...args: unknown[]) => pickupPin(...args),
  },
}));

// Defaults to a resolved `null` (no payment on record) so the cancel-affordance
// suite below, which never touches this mock itself, gets the same outcome its
// own file originally hard-coded (`forOrder: () => Promise.resolve(null)`).
// Restored after every test's mockReset() in the shared afterEach, since
// mockReset() clears a vi.fn's constructor-time implementation too (verified
// empirically — mockClear() would have preserved it, mockReset() does not).
const forOrder = vi.fn(() => Promise.resolve(null));
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

// Separate fixture for the cancel-affordance suite below: a different default
// shape (DELIVERY, not PICKUP; a fuller item record) than `order()` above, so
// it keeps its own name rather than being folded into `order()`/`vendorOrder()`.
function cancelOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order1',
    orderNumber: 'BML-0001',
    status: 'PENDING',
    currency: 'BZD',
    itemCount: 1,
    subtotalMinor: 1000,
    deliveryFeeMinor: 0,
    totalMinor: 1000,
    placedAt: new Date().toISOString(),
    deliveryAddress: null,
    vendorOrders: [
      {
        id: 'vo1',
        orderNumber: 'BML-0001-A',
        status: 'PENDING',
        deliveryMethod: 'DELIVERY',
        customerNotes: null,
        currency: 'BZD',
        itemCount: 1,
        subtotalMinor: 1000,
        vendor: { businessName: 'Test Store', slug: 'test-store' },
        items: [{ productTitle: 'A Widget', variantTitle: null, sku: null, unitPriceMinor: 1000, quantity: 1, subtotalMinor: 1000, currency: 'BZD', productId: 'p1', imageUrl: null }],
        delivery: null,
      },
    ],
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let confirmSpy: { mockRestore: () => void } | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  getOwn.mockReset();
  cancel.mockReset();
  pickupPin.mockReset();
  forOrder.mockReset();
  forOrder.mockResolvedValue(null);
  confirmSpy?.mockRestore();
  confirmSpy = null;
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

/**
 * MDF — the cancel endpoint (apps/api orders.controller.ts) already existed,
 * worked and was correctly restricted to PENDING orders, but had zero
 * references anywhere in apps/web: a built, paid-for capability with no
 * button. This is the button's own regression guard.
 */
describe('order detail page — cancel affordance', () => {
  it('shows "Cancel order" while every vendor-order is PENDING', async () => {
    getOwn.mockResolvedValue(cancelOrder());
    const el = await mount();
    expect(el.textContent).toContain('Cancel order');
  });

  it('hides "Cancel order" once a vendor-order has moved past PENDING', async () => {
    getOwn.mockResolvedValue(cancelOrder({ vendorOrders: [{ ...cancelOrder().vendorOrders[0], status: 'PREPARING' }] }));
    const el = await mount();
    expect(el.textContent).not.toContain('Cancel order');
  });

  it('hides "Cancel order" once the order itself is CANCELLED', async () => {
    getOwn.mockResolvedValue(cancelOrder({ status: 'CANCELLED' }));
    const el = await mount();
    expect(el.textContent).not.toContain('Cancel order');
  });

  it('asks for confirmation, calls the API, and reflects the new state without a manual reload', async () => {
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    getOwn.mockResolvedValueOnce(cancelOrder());
    cancel.mockResolvedValue(undefined);
    // The real cancelOwn() returns the fresh order; the page reloads via
    // getOwn() afterwards, matching the existing addresses-page pattern
    // (await load() rather than trusting the mutation's own response).
    getOwn.mockResolvedValueOnce(cancelOrder({ status: 'CANCELLED', vendorOrders: [{ ...cancelOrder().vendorOrders[0], status: 'CANCELLED' }] }));

    const el = await mount();
    expect(el.textContent).toContain('Cancel order');

    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Cancel order')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith('order1');
    expect(getOwn).toHaveBeenCalledTimes(2);
    expect(el.textContent).not.toContain('Cancel order');
  });

  it('declining the confirmation prompt never calls the API', async () => {
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    getOwn.mockResolvedValue(cancelOrder());

    const el = await mount();
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Cancel order')!;
    await act(async () => {
      button.click();
    });

    expect(cancel).not.toHaveBeenCalled();
  });

  it('surfaces the server\'s real refusal message (the vendor-started-preparing race) instead of a generic error', async () => {
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    getOwn.mockResolvedValue(cancelOrder());
    cancel.mockRejectedValue({ status: 409, message: 'The store has already started preparing this order, so it can no longer be cancelled.' });

    const el = await mount();
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Cancel order')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(el.textContent).toContain('The store has already started preparing this order, so it can no longer be cancelled.');
  });

  it('a 409 refusal still re-fetches, so the stale button and PENDING vendor-order correct themselves without a manual reload', async () => {
    // The race the server guards against: a vendor starts preparing while
    // this page is still open. The refusal text is right either way, but
    // the view must stop claiming the order is still cancellable once the
    // server has said otherwise -- that claim is only true if THIS path
    // re-fetches too, not only the success path.
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    getOwn.mockResolvedValueOnce(cancelOrder());
    cancel.mockRejectedValue({ status: 409, message: 'The store has already started preparing this order, so it can no longer be cancelled.' });
    getOwn.mockResolvedValueOnce(cancelOrder({ vendorOrders: [{ ...cancelOrder().vendorOrders[0], status: 'PREPARING' }] }));

    const el = await mount();
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Cancel order')!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getOwn).toHaveBeenCalledTimes(2);
    expect(el.textContent).not.toContain('Cancel order');
    expect(el.textContent).toContain('The store has already started preparing this order, so it can no longer be cancelled.');
  });
});

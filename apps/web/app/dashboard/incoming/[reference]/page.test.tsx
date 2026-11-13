// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IncomingShipmentPage from './page';
import type { LinkedRecipientTrackingView } from '../../../../lib/shipping';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
const params = { reference: 'BML-9' };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => params,
}));

const incomingOne = vi.fn();
const incomingDeliveryCode = vi.fn();
const incomingCollectionCode = vi.fn();
vi.mock('../../../../lib/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/shipping')>();
  return {
    ...actual,
    shippingApi: {
      ...actual.shippingApi,
      incomingOne: (...args: unknown[]) => incomingOne(...args),
      incomingDeliveryCode: (...args: unknown[]) => incomingDeliveryCode(...args),
      incomingCollectionCode: (...args: unknown[]) => incomingCollectionCode(...args),
    },
  };
});

const view: LinkedRecipientTrackingView = {
  reference: 'BML-9',
  status: 'IN_TRANSIT',
  statusLabel: 'In transit',
  serviceLabel: 'Door to door',
  bookedAt: null,
  deliveredAt: null,
  destination: { city: 'Belize City', district: 'Belize' },
  collectionHub: null,
  steps: [],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  incomingOne.mockReset();
  incomingDeliveryCode.mockReset();
  incomingCollectionCode.mockReset();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<IncomingShipmentPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

/**
 * MDF-738 (Item 11): a signed-in, linked recipient is WORSE OFF than a
 * stranger until this page actually offers the collection code -- #700 gave
 * the anonymous tracking page a full path; this is the same gate
 * (collectionHub present = genuinely AWAITING_COLLECTION) applied to the
 * account's own "incoming parcel" view.
 */
describe('/dashboard/incoming/[reference] — linked-recipient collection code (MDF-738)', () => {
  it('offers "Your collection code" while the parcel is awaiting collection at a hub', async () => {
    incomingOne.mockResolvedValue({
      ...view,
      status: 'AWAITING_COLLECTION',
      statusLabel: 'Awaiting collection',
      collectionHub: { name: 'Belize City Hub', city: 'Belize City', address: null, instructions: null },
    });
    incomingDeliveryCode.mockResolvedValue({ reference: 'BML-9', deliveryCode: null });
    incomingCollectionCode.mockResolvedValue({ reference: 'BML-9', collectionCode: '4821' });

    const c = await mount();

    expect(incomingCollectionCode).toHaveBeenCalledWith('BML-9');
    expect(c.textContent).toContain('Your collection code');
    expect(c.textContent).toContain('4821');
  });

  it('never offers "Your collection code" for a shipment with no collection hub, and never even asks for one', async () => {
    incomingOne.mockResolvedValue(view); // collectionHub: null
    incomingDeliveryCode.mockResolvedValue({ reference: 'BML-9', deliveryCode: null });

    const c = await mount();

    expect(incomingCollectionCode).not.toHaveBeenCalled();
    expect(c.textContent).not.toContain('Your collection code');
  });
});

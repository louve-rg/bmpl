// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RecipientTrackingPage from './page';
import type { RecipientTrackingView } from '../../../lib/shipping';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stable references: an unstable mock object here can loop a useEffect forever (BMPL-380).
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
const params = { token: 'anon-token' };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => params,
}));

const trackPublic = vi.fn();
const incomingCourierConversation = vi.fn();
vi.mock('../../../lib/shipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/shipping')>();
  return {
    ...actual,
    shippingApi: {
      ...actual.shippingApi,
      trackPublic: (...args: unknown[]) => trackPublic(...args),
      incomingCourierConversation: (...args: unknown[]) => incomingCourierConversation(...args),
    },
  };
});

const view: RecipientTrackingView = {
  reference: 'BML-9',
  status: 'IN_TRANSIT',
  statusLabel: 'In transit',
  serviceLabel: 'Door to door',
  bookedAt: null,
  deliveredAt: null,
  destination: { city: 'Belize City', district: 'Belize' },
  collectionHub: null,
  deliveryCodeEligible: false,
  steps: [],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  trackPublic.mockReset();
  incomingCourierConversation.mockReset();
});

describe('anonymous /track/[token] page', () => {
  it('never shows the courier-message entry point and never asks for a conversation, even when one is open', async () => {
    trackPublic.mockResolvedValue(view);
    // Even if the API would answer with an id, the anonymous view must not reach for it.
    incomingCourierConversation.mockResolvedValue({ conversationId: 'conv-secret' });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<RecipientTrackingPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(trackPublic).toHaveBeenCalledWith('anon-token');
    expect(container!.textContent).toContain('In transit');
    expect(incomingCourierConversation).not.toHaveBeenCalled();
    expect(container!.querySelector('a[href*="/dashboard/messages"]')).toBeNull();
    expect(container!.textContent).not.toContain('Message your courier');
  });

  /**
   * MDF-710: the collection-ready email tells the recipient to "visit your
   * tracking page to see your collection code" -- this proves that page
   * actually offers it, and only in the window the email means (while the
   * shipment is genuinely AWAITING_COLLECTION, signalled by `collectionHub`
   * being present).
   */
  it('offers "Get your collection code" while the shipment is awaiting collection at a hub', async () => {
    trackPublic.mockResolvedValue({
      ...view,
      status: 'AWAITING_COLLECTION',
      statusLabel: 'Awaiting collection',
      collectionHub: { name: 'Belize City Hub', city: 'Belize City', address: null, instructions: null },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<RecipientTrackingPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container!.textContent).toContain('Get your collection code');
  });

  it('never offers "Get your collection code" for a shipment with no collection hub', async () => {
    trackPublic.mockResolvedValue(view); // collectionHub: null, per the fixture above

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<RecipientTrackingPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container!.textContent).not.toContain('Get your collection code');
  });

  /**
   * TRACK-PUBLIC-PAGE-DELIVERY-CODE-HEADING: a hub-to-hub parcel has no
   * LAST_MILE/DIRECT leg, so no driver will ever ask for a delivery code --
   * `deliveryCodeEligible: false` says so at EVERY status, not only once
   * AWAITING_COLLECTION. Gating on `collectionHub` alone (null for most of
   * the journey) would have let the false "Your driver will ask" card
   * survive through the whole in-transit window; these two cases are
   * exactly that window and the one status after it.
   */
  it('shows only the collection card, never the driver delivery-code card, for a hub-to-hub parcel in transit', async () => {
    trackPublic.mockResolvedValue({
      ...view,
      status: 'IN_TRANSIT',
      statusLabel: 'In transit',
      deliveryCodeEligible: false,
      collectionHub: null,
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<RecipientTrackingPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container!.textContent).not.toContain('Get your delivery code');
    expect(container!.textContent).not.toContain('Your driver will ask');
    // Nothing to collect yet either -- collectionHub is still null at this status.
    expect(container!.textContent).not.toContain('Get your collection code');
  });

  it('shows only the collection card, never the driver delivery-code card, for the same hub-to-hub parcel once awaiting collection', async () => {
    trackPublic.mockResolvedValue({
      ...view,
      status: 'AWAITING_COLLECTION',
      statusLabel: 'Awaiting collection',
      deliveryCodeEligible: false,
      collectionHub: { name: 'Belize City Hub', city: 'Belize City', address: null, instructions: null },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<RecipientTrackingPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container!.textContent).not.toContain('Get your delivery code');
    expect(container!.textContent).not.toContain('Your driver will ask');
    expect(container!.textContent).toContain('Get your collection code');
  });

  it('offers "Get your delivery code" for a door-to-door parcel with a real LAST_MILE leg', async () => {
    trackPublic.mockResolvedValue({ ...view, deliveryCodeEligible: true });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<RecipientTrackingPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container!.textContent).toContain('Get your delivery code');
  });
});

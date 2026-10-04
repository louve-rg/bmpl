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
});

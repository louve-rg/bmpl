// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeView } from '../../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The three summary boxes. Pins: a customer sees "Not applicable" (never 0)
 * for Jobs and Earnings; "No wallet yet" when the wallet does not exist (never
 * a zero balance); a driver's today figure is a real sum; the word "payout"
 * never appears.
 */
const apiGet = vi.fn();
const walletSummary = vi.fn();
vi.mock('../../lib/api', () => ({ api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn() } }));
vi.mock('../../lib/wallet', () => ({ walletApi: { summary: (...a: unknown[]) => walletSummary(...a) } }));

import { AccountSummary } from './AccountSummary';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  apiGet.mockReset();
  walletSummary.mockReset();
});

function me(roles: string[]): MeView {
  return {
    id: 'u1',
    firstName: 'Rae',
    lastName: 'Test',
    roles: roles.map((roleCode) => ({ roleCode, label: roleCode, status: 'APPROVED', isSelectable: true })),
  } as unknown as MeView;
}

async function render(m: MeView): Promise<string> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AccountSummary me={m} tone="light" />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return container.textContent ?? '';
}

describe('AccountSummary', () => {
  it('shows Not applicable for Jobs and Earnings to a customer, and No wallet yet rather than a zero', async () => {
    walletSummary.mockResolvedValue({ exists: false, currency: 'BZD', availableMinor: 0 });
    const text = await render(me(['CUSTOMER']));
    // Guard: the component rendered and loaded before asserting absence.
    expect(text).toContain('No wallet yet');
    expect(text).toContain('no job role on this account');
    expect(text).toContain('no earning role on this account');
    expect(text).not.toContain('$0.00');
    expect(text).not.toMatch(/payout/i);
  });

  it('shows a driver a real today figure from the earnings list, and a count of deliveries', async () => {
    const now = new Date();
    const todayRow = { calculatedAt: now.toISOString(), netMinor: 1250, status: 'POSTED', currency: 'BZD' };
    apiGet.mockImplementation((path: string) =>
      Promise.resolve(path === '/driver/earnings' ? { earnings: [todayRow] } : []),
    );
    walletSummary.mockResolvedValue({ exists: true, currency: 'BZD', availableMinor: 2000 });
    const text = await render(me(['DELIVERY_DRIVER']));
    expect(text).toContain('$12.50');
    // Label first on every value line, so the two lines in one box read the same way.
    expect(text).toContain('Deliveries: 1');
    expect(text).toContain('Delivery earnings today: $12.50');
    expect(text).toContain('Delivery earnings today');
    expect(text).toContain('driver deliveries');
    expect(text).toContain('$20.00');
    expect(text).not.toMatch(/payout/i);
  });

  it('says Not available when the earnings call fails, never 0', async () => {
    apiGet.mockRejectedValue(new Error('down'));
    walletSummary.mockRejectedValue(new Error('down'));
    const text = await render(me(['DELIVERY_DRIVER']));
    expect(text).toContain('Delivery earnings today: Not available');
    expect(text).not.toContain('$0.00');
  });
});

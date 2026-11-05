// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardNavList } from './DashboardNavList';
import type { MeView } from '../../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-526: a carrier applicant's own pending application must be findable
 * from the nav before the SHIPPING_PROVIDER role is approved — see
 * `useCarrierApplicationStatus` and `visibleRoleGroupsWithOverrides`. These
 * tests exercise the composed behaviour; the underlying pure functions have
 * their own unit tests in dashboard-nav.test.ts and shipping-provider.test.ts.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

const apiGet = vi.fn();
vi.mock('../../lib/api', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

function meWith(roles: MeView['roles']): MeView {
  return {
    id: 'u1',
    email: 'carrier@example.com',
    firstName: 'C',
    lastName: 'A',
    phone: null,
    district: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    avatarUrl: null,
    avatarStatus: 'NONE',
    avatarPendingUrl: null,
    avatarRejectedReason: null,
    avatarRequired: false,
    status: 'ACTIVE',
    emailVerified: true,
    activeRole: 'CUSTOMER',
    roles,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiGet.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

async function mount(me: MeView) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<DashboardNavList me={me} unread={0} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

describe('DashboardNavList — Carrier group (MDF-526)', () => {
  it('is hidden for a user who never started a carrier profile', async () => {
    apiGet.mockImplementation((path: string) => (path === '/shipping/provider/profile' ? Promise.resolve(null) : Promise.resolve([])));
    const c = await mount(meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }]));

    expect(c.textContent).not.toMatch(/Carrier/);
  });

  it('is shown, labelled Pending, for a PENDING application before role approval', async () => {
    apiGet.mockImplementation((path: string) =>
      path === '/shipping/provider/profile' ? Promise.resolve({ id: 'p1', status: 'PENDING' }) : Promise.resolve([]),
    );
    const c = await mount(meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }]));

    expect(c.textContent).toMatch(/Carrier/);
    expect(c.textContent).toMatch(/Pending/);
  });

  it('drops the pending badge once the SHIPPING_PROVIDER role itself is approved', async () => {
    apiGet.mockImplementation((path: string) =>
      path === '/shipping/provider/profile' ? Promise.resolve({ id: 'p1', status: 'APPROVED' }) : Promise.resolve([]),
    );
    const c = await mount(
      meWith([
        { roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true },
        { roleCode: 'SHIPPING_PROVIDER', label: 'Carrier', status: 'APPROVED', isSelectable: true },
      ]),
    );

    expect(c.textContent).toMatch(/Carrier/);
    expect(c.textContent).not.toMatch(/Pending/);
    expect(c.textContent).not.toMatch(/Role pending/);
  });

  it('shows a REJECTED application\'s own status rather than a generic "pending" label', async () => {
    apiGet.mockImplementation((path: string) =>
      path === '/shipping/provider/profile' ? Promise.resolve({ id: 'p1', status: 'REJECTED' }) : Promise.resolve([]),
    );
    const c = await mount(meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }]));

    expect(c.textContent).toMatch(/Carrier/);
    expect(c.textContent).toMatch(/Rejected/);
  });
});

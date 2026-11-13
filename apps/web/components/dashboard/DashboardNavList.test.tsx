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

const routerPush = vi.fn();
// A fresh `{ push: routerPush }` literal on every call would change identity
// every render -- unlike the real `useRouter()`, which returns a stable
// object from context -- and the hook's effect depends on `router`, so an
// unstable mock would re-run the effect (and re-fetch) on every render.
const mockRouter = { push: routerPush };
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => mockRouter }));

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
  routerPush.mockReset();
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

/**
 * TERM-11: terminal staff hold no account role code at all, so "Terminal" can
 * only ever appear through this same forced-visible override shape MDF-526
 * built for Carrier -- see useTerminalMembership and the empty `requires: []`
 * on the Terminal entry in dashboard-nav-items.ts.
 */
describe('DashboardNavList — Terminal group (TERM-11)', () => {
  it('is hidden for a user with no active terminal company membership', async () => {
    apiGet.mockImplementation((path: string) => (path === '/terminal/me' ? Promise.reject({ status: 403 }) : Promise.resolve([])));
    const c = await mount(meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }]));

    expect(c.textContent).not.toMatch(/Terminal/);
  });

  it('is shown for an active terminal company member, even though no account role grants it', async () => {
    apiGet.mockImplementation((path: string) =>
      path === '/terminal/me'
        ? Promise.resolve({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'OPERATOR', locations: [] })
        : Promise.resolve([]),
    );
    const c = await mount(meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }]));

    expect(c.textContent).toMatch(/Terminal/);
    expect(c.textContent).toMatch(/Terminal Workspace/);
  });

  /**
   * F-NAV: Stanley drove the real product as an invited Manager and landed
   * on the ordinary customer dashboard with the only route to the workspace
   * a COLLAPSED "Terminal" group below ~18 customer items, below the fold
   * at 1280x900. `textContent` matching "Terminal Workspace" (the test
   * above) does not prove the link is actually reachable without a click --
   * jsdom still includes a `hidden`-classed element's text, which is
   * exactly how this stayed uncaught. This checks the real rendered state:
   * the group's own item container must NOT carry the `hidden` class the
   * collapsed state applies (DashboardNavList.tsx's isOpen/render), with
   * the mocked pathname ('/dashboard', mocked at the top of this file) NOT
   * inside the Terminal group at all -- proving membership alone opens it,
   * not happening to already be on one of its pages.
   */
  it('the Terminal group is expanded by default for a member -- not collapsed behind a click (F-NAV)', async () => {
    apiGet.mockImplementation((path: string) =>
      path === '/terminal/me'
        ? Promise.resolve({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'OPERATOR', locations: [] })
        : Promise.resolve([]),
    );
    const c = await mount(meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }]));

    const link = Array.from(c.querySelectorAll('a')).find((a) => a.textContent === 'Terminal Workspace');
    expect(link).toBeDefined();
    const itemsContainer = link!.closest('div')!;
    expect(itemsContainer.className).not.toMatch(/hidden/);
  });

  it('does not affect whether the Carrier group shows -- the two overrides are independent', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === '/terminal/me') return Promise.resolve({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'OPERATOR', locations: [] });
      if (path === '/shipping/provider/profile') return Promise.resolve(null);
      return Promise.resolve([]);
    });
    const c = await mount(meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }]));

    expect(c.textContent).toMatch(/Terminal/);
    expect(c.textContent).not.toMatch(/Carrier/);
  });

  /**
   * MDF-720: Jim's live run (apps/web/e2e/mdf720-terminal-membership-
   * loading-state.local-only.spec.ts) proved the defect was logic-shaped --
   * `isMember` only ever flipped `true` on success, so a pending fetch, a
   * failed fetch and a genuine non-member were ALL the identical silent
   * "hide the nav" state, forever, for the failed case. These tests drive
   * each of the four distinct outcomes (loading/member/not-member/error)
   * `useTerminalMembership` now exposes, using fake timers for the retry
   * backoff and a manually-resolved promise to observe the loading state
   * before it settles.
   */
  describe('MDF-720 — loading, error and not-a-member are three visibly distinct outcomes, never collapsed into one', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows a visible loading affordance while the first check is pending -- never the same blank state a non-member sees', async () => {
      let resolveMe: ((v: unknown) => void) | undefined;
      apiGet.mockImplementation((path: string) =>
        path === '/terminal/me' ? new Promise((resolve) => { resolveMe = resolve; }) : Promise.resolve([]),
      );

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<DashboardNavList me={meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }])} unread={0} />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector('[data-testid="terminal-membership-loading"]')).not.toBeNull();
      expect(container.textContent).toMatch(/Loading terminal access/);
      expect(container.textContent).not.toMatch(/Terminal Workspace/);

      await act(async () => {
        resolveMe!({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'MANAGER', locations: [] });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.textContent).toMatch(/Terminal Workspace/);
      expect(container.querySelector('[data-testid="terminal-membership-loading"]')).toBeNull();
    });

    it('shows a visible error affordance on a non-403 failure (network error, timeout, 5xx) -- never the same blank state a non-member sees', async () => {
      let calls = 0;
      apiGet.mockImplementation((path: string) => {
        if (path !== '/terminal/me') return Promise.resolve([]);
        calls += 1;
        return Promise.reject(new Error('network error'));
      });

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<DashboardNavList me={meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }])} unread={0} />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector('[data-testid="terminal-membership-error"]')).not.toBeNull();
      expect(container.textContent).toMatch(/something went wrong/i);
      expect(container.textContent).toMatch(/try again/i);
      expect(container.textContent).not.toMatch(/Terminal Workspace/);
      expect(calls).toBe(1);
    });

    it('retries automatically on a backoff after a non-403 failure, and shows the nav once a retry succeeds', async () => {
      let calls = 0;
      apiGet.mockImplementation((path: string) => {
        if (path !== '/terminal/me') return Promise.resolve([]);
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('network error'));
        return Promise.resolve({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'MANAGER', locations: [] });
      });

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<DashboardNavList me={meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }])} unread={0} />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(calls).toBe(1);
      expect(container.querySelector('[data-testid="terminal-membership-error"]')).not.toBeNull();

      // Advance past the first backoff delay (1000ms) and flush the retry.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(calls).toBe(2);
      expect(container.textContent).toMatch(/Terminal Workspace/);
      expect(container.querySelector('[data-testid="terminal-membership-error"]')).toBeNull();
    });

    it('a manual "Try again" click retries immediately, without waiting for the backoff timer', async () => {
      let calls = 0;
      apiGet.mockImplementation((path: string) => {
        if (path !== '/terminal/me') return Promise.resolve([]);
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('network error'));
        return Promise.resolve({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'OPERATOR', locations: [] });
      });

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<DashboardNavList me={meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }])} unread={0} />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(calls).toBe(1);
      const retryButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Try again')!;
      expect(retryButton).toBeDefined();

      await act(async () => {
        retryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      // Resolved on the click itself -- no timer advanced.
      expect(calls).toBe(2);
      expect(container.textContent).toMatch(/Terminal Workspace/);
    });

    it('never retries after a real 403, and shows neither the loading nor the error affordance -- the definitive, correct "not a member" case', async () => {
      let calls = 0;
      apiGet.mockImplementation((path: string) => {
        if (path !== '/terminal/me') return Promise.resolve([]);
        calls += 1;
        return Promise.reject({ status: 403 });
      });

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<DashboardNavList me={meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }])} unread={0} />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(calls).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });

      // No retry ever fired for a confirmed non-member.
      expect(calls).toBe(1);
      expect(container.textContent).not.toMatch(/Terminal/);
      expect(container.querySelector('[data-testid="terminal-membership-loading"]')).toBeNull();
      expect(container.querySelector('[data-testid="terminal-membership-error"]')).toBeNull();
    });
  });

  /**
   * MDF-733: a 401 used to fall into the same bucket as a network error or
   * a 5xx -- `error`, retried forever on the backoff, "Something went
   * wrong" shown to a user whose session had simply ended. `api.get`
   * (lib/api.ts) already tries one silent refresh before a 401 ever
   * reaches here, so this is a genuinely expired session, the same
   * condition every other page's own `status === 401` check sends to
   * `/login?next=...` for.
   */
  describe('MDF-733 — an expired session (401) sends the user to sign in, not an infinite retry loop', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not show the error affordance or retry on a 401 -- it redirects to sign-in instead', async () => {
      let calls = 0;
      apiGet.mockImplementation((path: string) => {
        if (path !== '/terminal/me') return Promise.resolve([]);
        calls += 1;
        return Promise.reject({ status: 401 });
      });

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<DashboardNavList me={meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }])} unread={0} />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(calls).toBe(1);
      expect(routerPush).toHaveBeenCalledWith('/login?next=%2Fdashboard');
      expect(container.querySelector('[data-testid="terminal-membership-error"]')).toBeNull();
      expect(container.textContent).not.toMatch(/something went wrong/i);

      // Proves this is a real redirect, not merely a different label on the
      // same forever-retry bug: unlike the 403 and backoff tests above, no
      // amount of elapsed time issues a second request for a 401.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(calls).toBe(1);
      expect(routerPush).toHaveBeenCalledTimes(1);
    });

    it('shows the loading state again while a manual "Try again" re-check is in flight, not a frozen error screen', async () => {
      let calls = 0;
      let resolveSecond: ((v: unknown) => void) | undefined;
      apiGet.mockImplementation((path: string) => {
        if (path !== '/terminal/me') return Promise.resolve([]);
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('network error'));
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      });

      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(<DashboardNavList me={meWith([{ roleCode: 'CUSTOMER', label: 'Customer', status: 'APPROVED', isSelectable: true }])} unread={0} />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(calls).toBe(1);
      const retryButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Try again')!;
      expect(retryButton).toBeDefined();

      // The click issues the second request, which deliberately never
      // resolves in this act() -- a single act() around the click would let
      // React batch the error-cleared-to-loading transition away even
      // though the real request is still pending (the floor's own one-
      // act()-per-round-trip trap). A real timing gap between the click and
      // the next assertion is what proves this against the unfixed code,
      // where `status` never left 'error' until the request settled.
      await act(async () => {
        retryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(calls).toBe(2);
      expect(container.querySelector('[data-testid="terminal-membership-error"]')).toBeNull();
      expect(container.querySelector('[data-testid="terminal-membership-loading"]')).not.toBeNull();
      expect(container.textContent).toMatch(/Loading terminal access/);

      await act(async () => {
        resolveSecond!({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'OPERATOR', locations: [] });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector('[data-testid="terminal-membership-loading"]')).toBeNull();
      expect(container.textContent).toMatch(/Terminal Workspace/);
    });
  });
});

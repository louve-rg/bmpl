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

// Stable reference across renders -- a fresh object literal from useRouter()
// on every call would make the hook's effect (deps include `router`) look
// like it changed every render and re-run forever (BMPL-380's own hazard).
const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => router }));

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
  router.push.mockReset();
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
   * TERM-NAV-401 (Stanley's read of F-NAV). Two defects in the same hook:
   * a 401 was treated identically to any other failure -- retried forever
   * on the backoff, showing "Something went wrong" for a session that
   * merely ended, which "Try again" can never fix -- and a re-check that
   * failed again re-set `error` to the same value, so a working retry and
   * a dead one looked identical on screen.
   */
  describe('TERM-NAV-401 — a 401 is a dead session, not a retryable error', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('redirects to sign-in on a 401, shows neither loading nor error, and never schedules a retry', async () => {
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
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(router.push.mock.calls[0]![0]).toMatch(/^\/login\?next=/);
      // Never "Something went wrong" for a session that merely ended.
      expect(container.textContent).not.toMatch(/something went wrong/i);

      // No retry fires even after the full backoff window -- unlike a
      // genuine error, nothing here can self-heal an expired session.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      expect(calls).toBe(1);
      expect(router.push).toHaveBeenCalledTimes(1);
    });

    it('a retry that fails again visibly returns to loading first, rather than silently re-showing the same error', async () => {
      let calls = 0;
      let resolveSecond: (() => void) | undefined;
      apiGet.mockImplementation((path: string) => {
        if (path !== '/terminal/me') return Promise.resolve([]);
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('network error'));
        return new Promise((_resolve, reject) => {
          resolveSecond = () => reject(new Error('network error again'));
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

      expect(container.querySelector('[data-testid="terminal-membership-error"]')).not.toBeNull();
      const retryButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Try again')!;

      await act(async () => {
        retryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });

      // The second attempt is in flight (deliberately held open above) --
      // this must show loading, not the stale error affordance, proving
      // the retry visibly happened rather than nothing changing on screen.
      expect(container.querySelector('[data-testid="terminal-membership-loading"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="terminal-membership-error"]')).toBeNull();

      await act(async () => {
        resolveSecond!();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector('[data-testid="terminal-membership-error"]')).not.toBeNull();
    });
  });
});

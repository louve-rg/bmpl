// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutesManager } from './RoutesManager';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-526: `GET routes/available` landed status-gated the same way
 * `claimRoute` itself is (MDF-500 §13) — a SUSPENDED/REVOKED org must not
 * even enumerate newly-claimable routes, not just be blocked from claiming
 * one. These tests exercise the wrapped `{statusGateEligible,
 * statusGateReason, routes}` response, the honest-gap 404 fallback it
 * replaces, and the plain my-routes list.
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

const ROUTE = {
  id: 'route_1',
  mode: 'LAND',
  isActive: true,
  scheduleNote: null,
  origin: { id: 'h1', code: 'BZE', name: 'Belize City Hub', city: 'Belize City' },
  destination: { id: 'h2', code: 'SPR', name: 'San Pedro Hub', city: 'San Pedro' },
};

const AVAILABLE_ROUTE = { ...ROUTE, id: 'route_2' };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function mockEndpoints({
  myRoutes = [],
  available,
}: {
  myRoutes?: unknown[];
  available: unknown;
}) {
  apiGet.mockImplementation((path: string) => {
    if (path === '/shipping/provider/routes') return Promise.resolve(myRoutes);
    if (path === '/shipping/provider/routes/available') {
      if (available instanceof Error) return Promise.reject(available);
      return Promise.resolve(available);
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RoutesManager />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

function findButton(text: string) {
  return Array.from(container!.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) ?? null;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('RoutesManager — my routes', () => {
  it('lists an owned route and releases it', async () => {
    mockEndpoints({ myRoutes: [ROUTE], available: { statusGateEligible: true, statusGateReason: null, routes: [] } });
    apiPost.mockResolvedValue({});
    const c = await mount();

    expect(c.textContent).toContain('Belize City Hub');
    await click(findButton('Release')!);
    expect(apiPost).toHaveBeenCalledWith('/shipping/provider/routes/route_1/release', {});
  });
});

describe('RoutesManager — available to claim (eligible)', () => {
  it('lists an unclaimed route and claims it', async () => {
    mockEndpoints({ available: { statusGateEligible: true, statusGateReason: null, routes: [AVAILABLE_ROUTE] } });
    apiPost.mockResolvedValue({});
    const c = await mount();

    expect(c.textContent).toContain('San Pedro Hub');
    await click(findButton('Claim')!);
    expect(apiPost).toHaveBeenCalledWith('/shipping/provider/routes/route_2/claim', {});
  });

  it('shows a plain empty state when nothing is unclaimed', async () => {
    mockEndpoints({ available: { statusGateEligible: true, statusGateReason: null, routes: [] } });
    const c = await mount();

    expect(c.textContent).toContain('No unclaimed routes right now.');
  });
});

describe('RoutesManager — available to claim (status-gated)', () => {
  it('shows the gate reason verbatim and discloses no routes, even if the API sent any', async () => {
    mockEndpoints({
      available: {
        statusGateEligible: false,
        statusGateReason: 'carrier status is suspended, not approved to operate',
        routes: [],
      },
    });
    const c = await mount();

    expect(c.textContent).toContain('carrier status is suspended, not approved to operate');
    expect(c.textContent).not.toContain('San Pedro Hub');
    expect(findButton('Claim')).toBeNull();
  });
});

describe('RoutesManager — honest gap (endpoint not deployed here yet)', () => {
  it('reads a 404 as "not supported yet", never a raw error or a route-id prompt', async () => {
    mockEndpoints({ available: Object.assign(new Error('Not Found'), { status: 404 }) });
    const c = await mount();

    expect(c.textContent).toMatch(/cannot yet list routes available to claim/);
    expect(c.textContent).not.toMatch(/Not Found/);
  });
});

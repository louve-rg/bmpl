// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISTRICTS } from '@bmpl/shared';
import { DriverCoverage } from './DriverCoverage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-560 (owner): the admin console had no surface saying which districts
 * have no approved driver — a same-town door-to-door order could fail at
 * booking for a reason nobody on the admin side could see. Mirrors
 * `GET /admin/drivers?district=&roleStatus=APPROVED`, the exact endpoint and
 * filter Jim already used by hand to count this per district.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(countByDistrict: Record<string, number>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/admin/drivers') {
        const district = url.searchParams.get('district') ?? '';
        const n = countByDistrict[district] ?? 0;
        return jsonResponse(200, Array.from({ length: n }, (_, i) => ({ id: `drv_${district}_${i}` })));
      }
      return jsonResponse(404, { message: 'not mocked: ' + url.pathname });
    }),
  );
}

function stubFetchForbidden() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(403, { message: 'Forbidden' })),
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<DriverCoverage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('DriverCoverage — per-district approved-driver readiness (MDF-560)', () => {
  it('flags a district with zero approved drivers and names it in the warning sentence, leaving a covered district alone', async () => {
    const counts: Record<string, number> = {};
    for (const d of DISTRICTS) counts[d] = d === 'TOLEDO' ? 0 : 2;
    stubFetch(counts);
    await mount();

    expect(document.body.textContent).toContain('Toledo');
    expect(document.body.textContent).toContain('No approved driver');
    expect(document.body.textContent).toContain('Some districts have no approved driver');
    // A covered district gets the count badge, not the warning badge.
    expect(document.body.textContent).toContain('2 approved drivers');
  });

  it('shows no warning once every district has at least one approved driver', async () => {
    const counts: Record<string, number> = {};
    for (const d of DISTRICTS) counts[d] = 1;
    stubFetch(counts);
    await mount();

    expect(document.body.textContent).not.toContain('No approved driver');
    expect(document.body.textContent).not.toContain('Some districts have no approved driver');
    expect(document.body.textContent).toContain('1 approved driver');
  });

  it('never offers a control to create a driver or a rate — read-only verification only', async () => {
    const counts: Record<string, number> = {};
    for (const d of DISTRICTS) counts[d] = 0;
    stubFetch(counts);
    await mount();

    expect(document.body.querySelectorAll('button, input, select, textarea').length).toBe(0);
  });

  it('reports a 403 as a permission explanation, not a generic error', async () => {
    stubFetchForbidden();
    await mount();

    expect(document.body.textContent).toContain('drivers.read');
  });
});

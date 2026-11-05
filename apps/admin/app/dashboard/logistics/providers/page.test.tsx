// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CarrierProvidersPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * MDF-500: the carrier directory, read-only this round (see
 * the page's own docstring for why management controls are not here yet —
 * there is no per-provider members read to confirm against). Covers the
 * list render and the honest "refused" vs "empty" distinction (BMPL-144).
 */

const PROVIDER_ACTIVE = {
  id: 'prov_1',
  businessName: 'Tropic Air',
  description: null,
  contactEmail: 'ops@tropicair.bz',
  contactPhone: '+501-610-0000',
  district: 'BELIZE',
  city: 'Belize City',
  addressLine1: null,
  operatingLicenceNumber: 'LIC-001',
  operatingLicenceExpiry: '2027-01-01T00:00:00.000Z',
  isActive: true,
  isTest: false,
  createdAt: new Date().toISOString(),
  activeMembers: 3,
};

const PROVIDER_DEACTIVATED = {
  ...PROVIDER_ACTIVE,
  id: 'prov_2',
  businessName: 'Retired Carrier',
  isActive: false,
  activeMembers: 0,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/logistics/providers')) return jsonResponse(status, body);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<CarrierProvidersPage />);
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

describe('CarrierProvidersPage (MDF-500)', () => {
  it('lists each carrier with its contact details, licence and active member count', async () => {
    stubFetch(200, [PROVIDER_ACTIVE]);
    await mount();

    expect(container!.textContent).toContain('Tropic Air');
    expect(container!.textContent).toContain('ops@tropicair.bz');
    expect(container!.textContent).toContain('LIC-001');
    expect(container!.textContent).toContain('3 active members');
  });

  it('marks a deactivated carrier distinctly from an active one', async () => {
    stubFetch(200, [PROVIDER_ACTIVE, PROVIDER_DEACTIVATED]);
    await mount();

    expect(container!.textContent).toContain('Active');
    expect(container!.textContent).toContain('Deactivated');
  });

  it('shows an honest empty state, not an error, when there are genuinely no carriers', async () => {
    stubFetch(200, []);
    await mount();

    expect(container!.textContent).toContain('No carriers yet');
  });

  it('shows the real refusal message on a 403, same convention as the other read-only list pages in this console', async () => {
    stubFetch(403, { message: 'You need the "logistics.read" permission.' });
    await mount();

    expect(container!.textContent).toContain('logistics.read');
  });

  it('links each carrier name to its own detail page (MDF-524)', async () => {
    stubFetch(200, [PROVIDER_ACTIVE]);
    await mount();

    const link = Array.from(container!.querySelectorAll('a')).find((a) => a.textContent === 'Tropic Air');
    expect(link?.getAttribute('href')).toBe('/dashboard/logistics/providers/prov_1');
  });
});

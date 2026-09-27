// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HubsPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-276: the hub console (BMPL-142's originally-settled pattern) hides
 * every write affordance from a logistics.read-only reader and shows them to
 * a logistics.manage operator. Exercised against a real (jsdom) DOM tree with
 * a stubbed fetch, because the claim is about what actually renders — a
 * `canManage && <Button>` that silently stops being wired up is exactly the
 * BMPL-267 defect shape, and a test of the canManage boolean in isolation
 * would not see it.
 */

const HUB = {
  id: 'hub_1',
  code: 'SPA',
  name: 'San Pedro Airstrip',
  type: 'AIRSTRIP',
  district: 'BELIZE',
  city: 'San Pedro',
  addressLine1: null,
  addressLine2: null,
  latitude: null,
  longitude: null,
  modes: ['AIR'],
  instructions: null,
  contactName: null,
  contactPhone: null,
  courierFeeMinor: 500,
  isActive: true,
  isTest: false,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(adminPermissions: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/logistics/hubs')) return jsonResponse(200, [HUB]);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<HubsPage />);
  });
  // Let both effects (hub list + /me) settle their fetch().then(setState).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function buttonTexts(): string[] {
  return Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('HubsPage — write affordances gated on logistics.manage (BMPL-276)', () => {
  it('a logistics.read-only reader sees no write affordance anywhere on the page', async () => {
    stubFetch(['logistics.read']);
    await mount();

    // Absent from the document, not merely disabled — a disabled button
    // would still satisfy a naive "cannot be clicked" check while regressing
    // straight back to the report-not-form ruling this card guards.
    const texts = buttonTexts();
    expect(texts).not.toContain('Add terminal');
    expect(texts.some((t) => t === 'Edit')).toBe(false);
    expect(texts.some((t) => t === 'Deactivate' || t === 'Activate')).toBe(false);
    expect(document.body.querySelector('#hub-code')).toBeNull();
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // The report half still stands: the rate is a fact, not a control.
    expect(document.body.textContent).toMatch(/BZ\$5\.00/);
  });

  it('a logistics.manage operator sees every write affordance', async () => {
    stubFetch(['logistics.manage']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Add terminal');
    expect(texts).toContain('Edit');
    expect(texts).toContain('Deactivate');
    expect(document.body.querySelector('#hub-code')).not.toBeNull();
  });
});

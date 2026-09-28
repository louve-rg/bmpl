// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CourierLanesPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-280: courier-lanes (BMPL-270) never had canManage gating at all until
 * this round, same vertical and same pattern as hubs/routes. The per-lane
 * rate is already shown as plain text on the read side of the card; only the
 * editable rate input and the open/close toggle needed gating.
 */

const LANE = {
  id: 'lane_1',
  originDistrict: 'BELIZE',
  originCity: 'Belize City',
  destinationDistrict: 'BELIZE',
  destinationCity: 'Ladyville',
  priceMinor: 2500,
  durationMinutes: 15,
  note: 'Northern Highway, no ferry',
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
      if (url.includes('/api/admin/logistics/courier-lanes')) return jsonResponse(200, [LANE]);
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
    root!.render(<CourierLanesPage />);
  });
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

describe('CourierLanesPage — write affordances gated on logistics.manage (BMPL-280)', () => {
  it('a logistics.read-only reader sees no write affordance anywhere on the page', async () => {
    stubFetch(['logistics.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Add lane');
    expect(texts.some((t) => t === 'Close lane' || t === 'Open lane')).toBe(false);
    expect(document.body.querySelector('#lane-from-city')).toBeNull();
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // Read-only report half: the rate and note are still information.
    expect(document.body.textContent).toMatch(/BZ\$25\.00/);
    expect(document.body.textContent).toMatch(/Northern Highway, no ferry/);
  });

  it('a logistics.manage operator sees every write affordance', async () => {
    stubFetch(['logistics.manage']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Add lane');
    expect(texts).toContain('Close lane');
    expect(document.body.querySelector('#lane-from-city')).not.toBeNull();
  });
});

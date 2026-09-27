// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarketingPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-274/276 shape: marketing's ad-placement tab (BMPL-269) hides the
 * assign-campaign form and every row control from a promotions.read-only
 * reader, and shows them to a promotions.manage operator. The page defaults
 * to the moderation tab, so the test clicks into "Ad Placements" first —
 * exactly what an operator would do — before asserting.
 */

const PLACEMENT_ROW = {
  id: 'pl_1',
  promotionId: 'promo_1',
  placement: 'HOMEPAGE_HERO' as const,
  position: 1,
  categoryId: null,
  isActive: true,
  device: 'BOTH' as const,
  startAt: null,
  endAt: null,
  assignedById: null,
  createdAt: new Date().toISOString(),
  promotion: { id: 'promo_1', title: 'Founders Week Sale', type: 'BANNER', status: 'APPROVED', priority: 10, isActive: true },
  category: null,
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
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });
      if (url.includes('/api/admin/marketing/placements')) return jsonResponse(200, [PLACEMENT_ROW]);
      // Moderation tab (mounted by default) and the placements form's
      // approved-campaign lookup both hit this — an empty list is enough for
      // both, since neither is what this test asserts on.
      if (url.includes('/api/admin/marketing/promotions')) return jsonResponse(200, []);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<MarketingPage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  // Switch to the "Ad Placements" tab, same as an operator clicking it.
  const tabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
  const placementsTab = tabs.find((t) => t.textContent?.trim() === 'Ad Placements');
  if (!placementsTab) throw new Error('Ad Placements tab not found');
  await act(async () => {
    placementsTab.click();
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

describe('MarketingPage — ad-placement write affordances gated on promotions.manage (BMPL-274)', () => {
  it('a promotions.read-only reader sees no write affordance in the placements tab', async () => {
    stubFetch(['promotions.read']);
    await mount();

    const texts = buttonTexts();
    expect(texts).not.toContain('Assign a campaign');
    expect(texts.some((t) => t === 'Pause' || t === 'Resume')).toBe(false);
    expect(texts.some((t) => t === 'Edit')).toBe(false);
    expect(texts.some((t) => t === 'Remove')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);

    // Read-only report half: the assignment itself is still information.
    expect(document.body.textContent).toMatch(/Founders Week Sale/);
    expect(document.body.textContent).toMatch(/Position 1/);
  });

  it('a promotions.manage operator sees every write affordance', async () => {
    stubFetch(['promotions.manage']);
    await mount();

    const texts = buttonTexts();
    expect(texts).toContain('Assign a campaign');
    expect(texts).toContain('Pause');
    expect(texts).toContain('Edit');
    expect(texts).toContain('Remove');
  });
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReviewsPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-281: the reviews console (BMPL-270 part B) gates hide/unhide/reject
 * on the reviews tab and action/dismiss on the reports tab behind the SAME
 * single permission, reviews.moderate — confirmed by checking the controller
 * rather than assuming a split existed just because the UI has two tabs
 * (part B's own commit message). One permission, two tabs, both asserted.
 *
 * The review fixture is PUBLISHED so Hide is status-eligible; the report
 * fixture is OPEN so Action/Dismiss are status-eligible.
 */

const REVIEW = {
  id: 'review_1',
  subjectType: 'PRODUCT' as const,
  subjectId: 'product_1',
  rating: 4,
  title: 'Good rice',
  body: 'Arrived on time and well packed.',
  status: 'PUBLISHED' as const,
  verifiedPurchase: true,
  helpfulCount: 2,
  variantName: null,
  sku: 'SKU-001',
  media: [],
  response: null,
  createdAt: new Date().toISOString(),
  editedAt: null,
  reportCount: 1,
  moderationReason: null,
};

const REPORT = {
  id: 'report_1',
  reviewId: 'review_1',
  reason: 'SPAM',
  note: 'Looks like spam.',
  status: 'OPEN' as const,
  createdAt: new Date().toISOString(),
  review: { id: 'review_1', subjectType: 'PRODUCT', body: 'Arrived on time and well packed.', status: 'PUBLISHED' },
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
      if (url.includes('/api/admin/reviews/reports')) return jsonResponse(200, [REPORT]);
      if (url.includes('/api/admin/reviews')) return jsonResponse(200, [REVIEW]);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<ReviewsPage />);
  });
  await settle();
}

async function clickTab(label: string) {
  const tabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
  const tab = tabs.find((t) => t.textContent?.trim() === label);
  if (!tab) throw new Error(`${label} tab not found`);
  await act(async () => {
    tab.click();
  });
  await settle();
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

describe('ReviewsPage — write affordances gated on reviews.moderate (BMPL-281)', () => {
  it('a reader sees no write affordance on either tab, zero disabled buttons, and the review/report facts still render', async () => {
    stubFetch(['reviews.read']);
    await mount();

    let texts = buttonTexts();
    expect(texts.some((t) => t === 'Hide')).toBe(false);
    expect(texts.some((t) => t === 'Reject')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Good rice/);
    expect(document.body.textContent).toMatch(/Arrived on time and well packed/);

    await clickTab('Reports');
    texts = buttonTexts();
    expect(texts.some((t) => t === 'Action')).toBe(false);
    expect(texts.some((t) => t === 'Dismiss')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
    expect(document.body.textContent).toMatch(/Looks like spam/);
  });

  it('a reviews.moderate holder sees write affordances on both tabs', async () => {
    stubFetch(['reviews.moderate']);
    await mount();

    let texts = buttonTexts();
    expect(texts).toContain('Hide');
    expect(texts).toContain('Reject');

    await clickTab('Reports');
    texts = buttonTexts();
    expect(texts).toContain('Action');
    expect(texts).toContain('Dismiss');
  });
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductModeration } from './ProductModeration';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-281: ProductModeration (BMPL-270 part B) gates approve/reject/
 * suspend/restore on the single products.moderate permission — identical
 * shape to VendorModeration. Tested as the component directly rather than
 * through products/[id]/page.tsx, which is an async Server Component using
 * serverGet()/cookies() and was proven uncoverable by this jsdom harness in
 * BMPL-280.
 *
 * next/navigation's useRouter is mocked for the same reason as
 * VendorModeration.test.tsx: called unconditionally, throws outside a real
 * App Router tree.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

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
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount(status: string) {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<ProductModeration id="product_1" status={status} />);
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

describe('ProductModeration — write affordances gated on products.moderate (BMPL-281)', () => {
  it('a reader sees neither Approve nor Reject for a PENDING_REVIEW product, and zero disabled buttons', async () => {
    stubFetch(['products.read']);
    await mount('PENDING_REVIEW');

    const texts = buttonTexts();
    expect(texts.some((t) => t === 'Approve')).toBe(false);
    expect(texts.some((t) => t === 'Reject')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
  });

  it('a products.moderate holder sees both Approve and Reject for a PENDING_REVIEW product', async () => {
    stubFetch(['products.moderate']);
    await mount('PENDING_REVIEW');

    const texts = buttonTexts();
    expect(texts).toContain('Approve');
    expect(texts).toContain('Reject');
  });

  it('a reader still sees the read-only DRAFT note — it carries no permission check at all', async () => {
    stubFetch(['products.read']);
    await mount('DRAFT');

    expect(document.body.textContent).toMatch(/No action available in .DRAFT./);
    expect(buttonTexts().length).toBe(0);
  });
});

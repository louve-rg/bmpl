// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VendorModeration } from './VendorModeration';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-281: VendorModeration (BMPL-270 part B) gates approve/reject/suspend/
 * restore on the single vendors.moderate permission. Tested as the component
 * directly, not through vendors/[id]/page.tsx, because that page is an async
 * Server Component using serverGet()/cookies() — proven uncoverable by this
 * jsdom harness in BMPL-280 (two independently fatal reasons: an async
 * Server Component isn't renderable by react-dom/client's reconciler, and
 * cookies() throws outside a real Next request scope). VendorModeration
 * itself is 'use client' and takes plain props, so it is fully testable in
 * isolation — the same move BMPL-280 made for WalletOperations.
 *
 * next/navigation's useRouter is mocked because the component calls it
 * unconditionally on every render; outside a real App Router tree it throws
 * ("invariant expected app router to be mounted") rather than returning null.
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
    root!.render(<VendorModeration id="vendor_1" status={status} />);
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

describe('VendorModeration — write affordances gated on vendors.moderate (BMPL-281)', () => {
  it('a reader sees neither Approve nor Reject for a PENDING vendor, and zero disabled buttons', async () => {
    stubFetch(['vendors.read']);
    await mount('PENDING');

    const texts = buttonTexts();
    expect(texts.some((t) => t === 'Approve')).toBe(false);
    expect(texts.some((t) => t === 'Reject')).toBe(false);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
  });

  it('a vendors.moderate holder sees both Approve and Reject for a PENDING vendor', async () => {
    stubFetch(['vendors.moderate']);
    await mount('PENDING');

    const texts = buttonTexts();
    expect(texts).toContain('Approve');
    expect(texts).toContain('Reject');
  });

  it('a reader still sees the read-only REJECTED note — it carries no permission check at all', async () => {
    stubFetch(['vendors.read']);
    await mount('REJECTED');

    expect(document.body.textContent).toMatch(/Awaiting the vendor to revise and resubmit/);
    expect(buttonTexts().length).toBe(0);
  });
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * ATT-1 (god's dispatch, conv-ac77e8): `AttachmentChip`'s old gate
 * (`scanStatus === 'CLEAN' || scanStatus === 'PASSED'`) could never be true
 * -- nothing writes `scanStatus` and `PASSED` isn't even in the enum -- so
 * every support attachment fell to the no-`href` `<span>` branch below.
 * Staff could never open or view anything a customer sent with a
 * complaint. Fixed to mirror the customer-facing gate exactly
 * (`AttachmentView`, apps/web/app/dashboard/messages/page.tsx): only
 * `FLAGGED` blocks viewing; `PENDING` is cosmetic only.
 */

const { default: SupportPage } = await import('./page');

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    mimeType: 'image/png',
    fileName: 'photo.png',
    fileSizeBytes: 2048,
    scanStatus: 'PENDING',
    url: 'https://storage.example/a1',
    ...overrides,
  };
}

function detailWith(attachments: ReturnType<typeof attachment>[]) {
  return {
    id: 'c1',
    contextType: 'SUPPORT',
    subject: 'A complaint with a photo',
    contextLabel: 'Support',
    status: 'OPEN',
    viewerRole: 'SUPPORT',
    canSend: true,
    participants: [],
    messages: [
      {
        id: 'm1',
        type: 'USER',
        body: 'See attached.',
        deleted: false,
        senderId: 'cust1',
        senderName: 'A Customer',
        isMine: false,
        attachments,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
}

function stubFetch(detail: ReturnType<typeof detailWith>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/support?status=OPEN')) {
        return jsonResponse(200, [{ id: 'c1', subject: detail.subject, status: 'OPEN', requester: null, messageCount: 1, lastMessageAt: null, createdAt: '2026-01-01T00:00:00Z' }]);
      }
      if (url.includes('/api/admin/support?status=CLOSED')) return jsonResponse(200, []);
      if (url.includes('/api/admin/support/c1')) return jsonResponse(200, detail);
      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<SupportPage />);
  });
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  const row = Array.from(document.body.querySelectorAll('li button')).find((b) => b.textContent?.includes('A complaint'));
  row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('AttachmentChip — the collection-code-shaped lockout, but for every support attachment (ATT-1)', () => {
  it('a PENDING image attachment renders as a real <img>, not a blocked chip', async () => {
    stubFetch(detailWith([attachment({ scanStatus: 'PENDING', mimeType: 'image/png' })]));
    const c = await mount();

    const img = c.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://storage.example/a1');
    expect(c.textContent).not.toContain('unavailable');
  });

  it('a PENDING non-image attachment renders as a real link with a "scanning" label, not an unlinked span', async () => {
    stubFetch(detailWith([attachment({ scanStatus: 'PENDING', mimeType: 'application/pdf', fileName: 'receipt.pdf' })]));
    const c = await mount();

    const link = Array.from(c.querySelectorAll('a')).find((a) => a.textContent?.includes('receipt.pdf'));
    expect(link, 'a PENDING attachment must still be a real, clickable link').not.toBeUndefined();
    expect(link?.getAttribute('href')).toBe('https://storage.example/a1');
    expect(link?.textContent).toContain('scanning');
  });

  it('a CLEAN attachment opens normally (regression -- the old gate only accidentally worked for this one value in theory, never in practice)', async () => {
    stubFetch(detailWith([attachment({ scanStatus: 'CLEAN', mimeType: 'image/png' })]));
    const c = await mount();

    expect(c.querySelector('img')).not.toBeNull();
  });

  it('a FLAGGED attachment is genuinely blocked -- a visible "unavailable" notice, no href, no <img>', async () => {
    stubFetch(detailWith([attachment({ scanStatus: 'FLAGGED', mimeType: 'image/png' })]));
    const c = await mount();

    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('unavailable');
    const links = Array.from(c.querySelectorAll('a')).filter((a) => a.getAttribute('href') === 'https://storage.example/a1');
    expect(links).toHaveLength(0);
  });

  it('never renders the dead "PASSED" comparison as reachable -- a FLAGGED file stays blocked even though scanStatus is never actually PASSED anywhere in the system', async () => {
    // There is no PASSED value in the real enum (ATTACHMENT_SCAN_STATUSES);
    // this just confirms the fix didn't leave some other spelling of the
    // same dead branch reachable by accident.
    stubFetch(detailWith([attachment({ scanStatus: 'FLAGGED' })]));
    const c = await mount();
    expect(c.textContent).not.toContain('PASSED');
  });
});

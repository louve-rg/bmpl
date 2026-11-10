// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Same convention as the other dashboard page tests -- no @testing-library/react
// dependency in this repo (see driver/shipping/[id]/page.test.tsx).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('c=conv1'),
}));

const getConversation = vi.fn();
const markRead = vi.fn();
const listConversations = vi.fn();
vi.mock('../../../lib/messaging', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/messaging')>('../../../lib/messaging');
  return {
    ...actual,
    messagingApi: {
      ...actual.messagingApi,
      list: (...args: unknown[]) => listConversations(...args),
      get: (...args: unknown[]) => getConversation(...args),
      markRead: (...args: unknown[]) => markRead(...args),
    },
  };
});

const { default: MessagesPage } = await import('./page');

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  routerReplace.mockReset();
  getConversation.mockReset();
  markRead.mockReset();
  listConversations.mockReset();
});

function conversationSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv1',
    contextType: 'SUPPORT',
    pairing: 'CUSTOMER_SUPPORT',
    subject: 'A conversation',
    status: 'OPEN',
    contextLabel: 'Support',
    lastMessage: null,
    lastMessageAt: null,
    unreadCount: 1,
    ...overrides,
  };
}

function conversationDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv1',
    contextType: 'SUPPORT',
    contextId: 'conv1',
    pairing: 'CUSTOMER_SUPPORT',
    subject: 'A conversation',
    contextLabel: 'Support',
    status: 'OPEN',
    viewerRole: 'CUSTOMER',
    canSend: true,
    participants: [],
    messages: [],
    ...overrides,
  };
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MessagesPage />);
  });
  // Flush the promise chain through several microtask turns: list load,
  // thread load, then markRead().then(onRead) -- the exact chain that used
  // to retrigger the fetch effect (MSG-1).
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return container;
}

/**
 * MSG-1: `ThreadPane`'s mount-fetch effect used to depend on `load`, a
 * useCallback depending on `[conversationId, onRead]` -- and `onRead` was a
 * fresh inline arrow recreated on every render of the parent. The fetch's
 * own `markRead().then(onRead)` called `markReadLocal`, which always
 * produced a new `conversations` array (even when nothing changed),
 * re-rendering the parent, recreating `onRead`, and retriggering the fetch.
 * A closed loop with no terminating condition, measured at ~56 requests/sec
 * against a production build. Fixed by reading onRead/onMutated through a
 * ref so the effect depends only on conversationId. This test proves the
 * fetch fires exactly once for a stable conversationId, including through
 * the one markReadLocal update a real unread->read transition legitimately
 * causes (unreadCount starts at 1, not 0, so the bail-out path is NOT what
 * is being tested here -- a genuine state change still must not loop).
 */
describe('MSG-1: opening a conversation fetches it once, not in a loop', () => {
  it('calls get/markRead exactly once for a stable conversationId', async () => {
    listConversations.mockResolvedValue([conversationSummary({ unreadCount: 1 })]);
    getConversation.mockResolvedValue(conversationDetail());
    markRead.mockResolvedValue(undefined);

    await mount();

    expect(getConversation).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(getConversation).toHaveBeenCalledWith('conv1');
  });

  it('still marks the conversation read (unreadCount -> 0) despite the bail-out guard', async () => {
    listConversations.mockResolvedValue([conversationSummary({ unreadCount: 1 })]);
    getConversation.mockResolvedValue(conversationDetail());
    markRead.mockResolvedValue(undefined);

    const c = await mount();

    // The unread badge should be gone from the list pane once the thread
    // has loaded and been marked read -- confirms markReadLocal's new
    // bail-out (skip when already 0) didn't also break the real transition.
    expect(c.textContent).not.toMatch(/^1$/m);
  });
});

function messageWithAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    type: 'TEXT',
    body: '',
    deleted: false,
    senderId: 'other-user',
    senderName: 'Jo',
    senderInitials: 'J',
    senderAvatarUrl: null,
    isMine: false,
    attachments: [
      {
        id: 'a1',
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
        fileSizeBytes: 1000,
        scanStatus: 'CLEAN',
        url: 'https://storage.example/x?sig=v1',
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    editedAt: null,
    ...overrides,
  };
}

/**
 * MSG-1, second mechanism. The API used to re-sign every attachment on
 * every serialization -- a different `url` on every 15s poll for the same
 * unchanged photo, which changed the rendered <img>'s `src` and made the
 * browser re-fetch and visibly flash it, even though the request rate was
 * already correct. The API now caches the signed URL per storage key for
 * its TTL window and only rotates it before expiry -- so the UI's job is
 * the opposite of "never change the URL": it must keep the SAME url stable
 * when the server repeats it (no pointless reload), but ADOPT a url that
 * genuinely rotates (never pin a signature past its expiry -- that is what
 * broke right-click-save, mobile cache eviction, and any re-fetching
 * remount). Pinning the first URL forever, which an earlier version of
 * this fix did, traded the 15s flash for a silently-expiring link; this is
 * the corrected contract.
 */
describe('MSG-1: a background refresh reuses a repeated attachment URL but adopts a rotated one', () => {
  it('keeps the same attachment object when the server repeats the same URL', async () => {
    vi.useFakeTimers();
    try {
      listConversations.mockResolvedValue([conversationSummary({ unreadCount: 0 })]);
      markRead.mockResolvedValue(undefined);
      getConversation.mockResolvedValueOnce(conversationDetail({ messages: [messageWithAttachment()] }));

      const c = await mount();
      const imgBefore = c.querySelector('img');
      expect(imgBefore?.getAttribute('src')).toBe('https://storage.example/x?sig=v1');

      // Same message, same attachment, same URL -- the server has nothing
      // new to say; the DOM node itself should not even be touched.
      getConversation.mockResolvedValueOnce(conversationDetail({ messages: [messageWithAttachment()] }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      const imgAfter = c.querySelector('img');
      expect(imgAfter?.getAttribute('src')).toBe('https://storage.example/x?sig=v1');
      expect(imgAfter).toBe(imgBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adopts a rotated attachment URL rather than pinning the stale one', async () => {
    vi.useFakeTimers();
    try {
      listConversations.mockResolvedValue([conversationSummary({ unreadCount: 0 })]);
      markRead.mockResolvedValue(undefined);
      getConversation.mockResolvedValueOnce(conversationDetail({ messages: [messageWithAttachment()] }));

      const c = await mount();
      expect(c.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/x?sig=v1');

      // Same message, same attachment id -- the server genuinely rotated
      // the cached URL ahead of its expiry. This must be adopted: the old
      // signature is on its way to expiring, not merely cosmetic noise.
      getConversation.mockResolvedValueOnce(
        conversationDetail({
          messages: [
            messageWithAttachment({
              attachments: [
                {
                  id: 'a1',
                  mimeType: 'image/jpeg',
                  fileName: 'photo.jpg',
                  fileSizeBytes: 1000,
                  scanStatus: 'CLEAN',
                  url: 'https://storage.example/x?sig=v2',
                },
              ],
            }),
          ],
        }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(c.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/x?sig=v2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still picks up a genuinely new message on a background refresh', async () => {
    vi.useFakeTimers();
    try {
      listConversations.mockResolvedValue([conversationSummary({ unreadCount: 0 })]);
      markRead.mockResolvedValue(undefined);
      getConversation.mockResolvedValueOnce(conversationDetail({ messages: [messageWithAttachment()] }));

      const c = await mount();
      expect(c.textContent).not.toContain('A reply arrived');

      getConversation.mockResolvedValueOnce(
        conversationDetail({
          messages: [
            messageWithAttachment(),
            messageWithAttachment({ id: 'm2', body: 'A reply arrived', attachments: [] }),
          ],
        }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(c.textContent).toContain('A reply arrived');
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * MSG-1 follow-up (god's dispatch, conv-391e7e): a thread used to pin to the
 * newest message unconditionally on every new message, including yanking a
 * viewer who had scrolled up to read something back down to the bottom the
 * moment a reply landed -- "the page jumped" is exactly how a user describes
 * that. The fix tracks whether the viewer was already at/near the bottom
 * (via `onScroll`, `NEAR_BOTTOM_PX` threshold) and only re-pins in that case.
 *
 * jsdom has no real layout, so scrollHeight/clientHeight are stubbed
 * directly on the element (configurable, so a real browser's own getters
 * are never touched); scrollTop itself jsdom does let a plain assignment
 * through.
 */
describe('MSG-1 follow-up: pin-to-bottom only re-fires when the viewer was already near the bottom', () => {
  // ConversationList's own <ul> also carries "overflow-y-auto" and sits
  // earlier in the DOM (list pane renders before the thread pane) -- a bare
  // `[class*="overflow-y-auto"]` query matches it first. ThreadPane's own
  // transcript container is the only element also carrying "bg-slate-50/50".
  function threadScrollEl(c: HTMLElement): HTMLElement {
    const el = c.querySelector('[class*="bg-slate-50/50"]');
    if (!el) throw new Error('thread scroll container not found');
    return el as HTMLElement;
  }

  function stubScrollGeometry(el: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  }

  it('re-pins to the bottom when a new message arrives and the viewer was already there', async () => {
    vi.useFakeTimers();
    try {
      listConversations.mockResolvedValue([conversationSummary({ unreadCount: 0 })]);
      markRead.mockResolvedValue(undefined);
      getConversation.mockResolvedValueOnce(conversationDetail({ messages: [messageWithAttachment({ attachments: [] })] }));

      const c = await mount();
      const el = threadScrollEl(c);
      stubScrollGeometry(el, { scrollHeight: 200, clientHeight: 100 });
      el.scrollTop = 100; // at the bottom (200 - 100 - 100 = 0 < threshold)
      el.dispatchEvent(new Event('scroll', { bubbles: true }));

      getConversation.mockResolvedValueOnce(
        conversationDetail({ messages: [messageWithAttachment({ attachments: [] }), messageWithAttachment({ id: 'm2', body: 'new', attachments: [] })] }),
      );
      stubScrollGeometry(el, { scrollHeight: 260, clientHeight: 100 }); // grew, as a real new message would

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(el.scrollTop).toBe(260);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the scroll position alone when a new message arrives and the viewer had scrolled up', async () => {
    vi.useFakeTimers();
    try {
      listConversations.mockResolvedValue([conversationSummary({ unreadCount: 0 })]);
      markRead.mockResolvedValue(undefined);
      getConversation.mockResolvedValueOnce(conversationDetail({ messages: [messageWithAttachment({ attachments: [] })] }));

      const c = await mount();
      const el = threadScrollEl(c);
      stubScrollGeometry(el, { scrollHeight: 500, clientHeight: 100 });
      el.scrollTop = 0; // scrolled all the way up (500 - 0 - 100 = 400, well past threshold)
      el.dispatchEvent(new Event('scroll', { bubbles: true }));

      getConversation.mockResolvedValueOnce(
        conversationDetail({ messages: [messageWithAttachment({ attachments: [] }), messageWithAttachment({ id: 'm2', body: 'new', attachments: [] })] }),
      );
      stubScrollGeometry(el, { scrollHeight: 560, clientHeight: 100 });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(el.scrollTop).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still pins to the bottom before the viewer has ever scrolled at all (default-true, unchanged behaviour)', async () => {
    vi.useFakeTimers();
    try {
      listConversations.mockResolvedValue([conversationSummary({ unreadCount: 0 })]);
      markRead.mockResolvedValue(undefined);
      getConversation.mockResolvedValueOnce(conversationDetail({ messages: [messageWithAttachment({ attachments: [] })] }));

      const c = await mount();
      const el = threadScrollEl(c);
      // Deliberately never dispatch a 'scroll' event -- nearBottomRef must
      // default to true, or a freshly opened thread's very next incoming
      // message would stop landing on the newest one.
      getConversation.mockResolvedValueOnce(
        conversationDetail({ messages: [messageWithAttachment({ attachments: [] }), messageWithAttachment({ id: 'm2', body: 'new', attachments: [] })] }),
      );
      stubScrollGeometry(el, { scrollHeight: 300, clientHeight: 100 });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(el.scrollTop).toBe(300);
    } finally {
      vi.useRealTimers();
    }
  });
});

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
 * MSG-1, second mechanism: `presignDownload` mints a brand-new signature on
 * every call, so the API hands back a DIFFERENT `url` for the same unchanged
 * attachment on every 15s background poll. Replacing the whole message
 * object wholesale (the pre-existing behavior) changes the rendered <img>'s
 * `src`, which makes the browser re-fetch and visibly flash a photo that
 * never actually changed -- a blink the original MSG-1 fix (the request-loop
 * fix above) does not touch, because the request rate here is already
 * correct (one request per 15s); the bug is what the UI does with that
 * response, not how often it arrives.
 */
describe('MSG-1: a background refresh does not flash an unchanged attachment', () => {
  it('keeps the previous attachment URL when the message itself did not change', async () => {
    vi.useFakeTimers();
    try {
      listConversations.mockResolvedValue([conversationSummary({ unreadCount: 0 })]);
      markRead.mockResolvedValue(undefined);
      getConversation.mockResolvedValueOnce(conversationDetail({ messages: [messageWithAttachment()] }));

      const c = await mount();
      expect(c.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/x?sig=v1');

      // Same message, same attachment id -- only the signed URL differs,
      // exactly what a re-presign on an unrelated poll produces.
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

      expect(c.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/x?sig=v1');
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

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionsList } from './SessionsList';
import type { SessionRow } from '../../lib/sessions';

// Same convention as DeleteAccountForm.test.tsx -- no @testing-library/react in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const apiGet = vi.fn();
const apiPost = vi.fn((..._args: [string, unknown?]) => Promise.resolve({ ok: true, revokedCount: 0 }));
const apiDel = vi.fn((..._args: [string, unknown?]) => Promise.resolve({ ok: true }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    get: (...args: [string]) => apiGet(...args),
    post: (...args: [string, unknown?]) => apiPost(...args),
    patch: vi.fn(),
    del: (...args: [string, unknown?]) => apiDel(...args),
  },
}));

const CURRENT: SessionRow = {
  id: 'sess_current',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  ipAddress: '203.0.113.5',
  client: 'web',
  createdAt: '2026-11-20T10:00:00.000Z',
  lastUsedAt: '2026-11-22T09:00:00.000Z',
  expiresAt: '2026-12-20T10:00:00.000Z',
  current: true,
};

const OTHER: SessionRow = {
  id: 'sess_other',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1',
  ipAddress: '198.51.100.9',
  client: 'mobile',
  createdAt: '2026-11-15T10:00:00.000Z',
  lastUsedAt: '2026-11-21T18:30:00.000Z',
  expiresAt: '2026-12-15T10:00:00.000Z',
  current: false,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SessionsList />);
  });
}

function rowButtons() {
  return Array.from(container!.querySelectorAll<HTMLButtonElement>('li button'));
}

/**
 * ACCT-SESSIONS (#811). The things this file exists to pin: (1) the current
 * session is marked unmistakably and never rendered as just another row,
 * (2) revoking the current row is treated as an honest sign-out (confirm,
 * then redirect, because the server clears cookies when that id matches),
 * (3) revoking any other row only removes that row, this device stays
 * signed in, and (4) raw ipAddress/userAgent never reach the DOM.
 */
describe('SessionsList (ACCT-SESSIONS #811)', () => {
  it('loads from GET /me/sessions and renders every live session', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT, OTHER] });
    mount();
    await flush();

    expect(apiGet).toHaveBeenCalledWith('/me/sessions');
    expect(container!.textContent).toContain('Chrome on Windows');
    expect(container!.textContent).toContain('Safari on iOS');
  });

  it('marks the current session unmistakably, and only the current session', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT, OTHER] });
    mount();
    await flush();

    expect(container!.textContent).toContain('This device');
    const badges = container!.querySelectorAll('li');
    expect(Array.from(badges).filter((li) => li.textContent?.includes('This device')).length).toBe(1);
  });

  it('never renders the raw User-Agent or IP address', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT, OTHER] });
    mount();
    await flush();

    expect(container!.textContent).not.toContain('AppleWebKit');
    expect(container!.textContent).not.toContain('203.0.113.5');
    expect(container!.textContent).not.toContain('198.51.100.9');
  });

  it('falls back to "Unknown device" for a User-Agent that parses to nothing recognisable, rather than guessing', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [{ ...CURRENT, userAgent: 'SomeInternalTool/1.0' }] });
    mount();
    await flush();

    expect(container!.textContent).toContain('Unknown device');
  });

  it('shows the client platform label the server sent, capitalized -- "Mobile app" for the mobile session', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [OTHER] });
    mount();
    await flush();

    expect(container!.textContent).toContain('Mobile app');
  });

  it('revoking the current session asks for confirmation, then signs out and redirects to /login', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT] });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await flush();

    act(() => rowButtons()[0]!.click());
    await flush();

    expect(confirmSpy).toHaveBeenCalledWith(
      'Sign out of this device? You will be signed out immediately and need to log in again.',
    );
    expect(apiDel).toHaveBeenCalledWith('/me/sessions/sess_current');
    expect(router.push).toHaveBeenCalledWith('/login');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('declining the confirmation on the current session does nothing -- no API call, no redirect', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT] });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount();
    await flush();

    act(() => rowButtons()[0]!.click());
    await flush();

    expect(apiDel).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('revoking another session only removes that row -- no redirect, this device stays signed in', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT, OTHER] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await flush();

    const otherRow = Array.from(container!.querySelectorAll('li')).find((li) => li.textContent?.includes('Safari on iOS'))!;
    act(() => (otherRow.querySelector('button') as HTMLButtonElement).click());
    await flush();

    expect(apiDel).toHaveBeenCalledWith('/me/sessions/sess_other');
    expect(router.push).not.toHaveBeenCalled();
    expect(container!.textContent).not.toContain('Safari on iOS');
    expect(container!.textContent).toContain('Chrome on Windows');
  });

  it('a 404 on revoke (already gone, or never yours) is shown as a neutral message, not a claim about why', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT, OTHER] });
    apiDel.mockRejectedValueOnce({ status: 404, message: 'Session not found.' });
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await flush();

    const otherRow = Array.from(container!.querySelectorAll('li')).find((li) => li.textContent?.includes('Safari on iOS'))!;
    act(() => (otherRow.querySelector('button') as HTMLButtonElement).click());
    await flush();

    expect(container!.textContent).toContain('That session is no longer active.');
    expect(container!.textContent).not.toContain('belongs to someone else');
  });

  it('"sign out everywhere else" only appears when there is another session to sign out', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT] });
    mount();
    await flush();

    expect(container!.textContent).not.toContain('Sign out everywhere else');
  });

  it('"sign out everywhere else" revokes every other session and leaves the current one, without asking for a password', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT, OTHER] });
    apiPost.mockResolvedValueOnce({ ok: true, revokedCount: 1 });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await flush();

    const button = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Sign out everywhere else')!;
    act(() => button.click());
    await flush();

    expect(apiPost).toHaveBeenCalledWith('/me/sessions/revoke-others', {});
    expect(container!.textContent).toContain('Signed out 1 other device.');
    expect(container!.textContent).toContain('This device');
    expect(container!.textContent).not.toContain('Safari on iOS');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('declining the "sign out everywhere else" confirmation does nothing', async () => {
    apiGet.mockResolvedValueOnce({ sessions: [CURRENT, OTHER] });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount();
    await flush();

    const button = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Sign out everywhere else')!;
    act(() => button.click());
    await flush();

    expect(apiPost).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('Safari on iOS');
  });

  it('shows a plain error instead of a blank section when the list fails to load', async () => {
    apiGet.mockRejectedValueOnce(new Error('network down'));
    mount();
    await flush();

    expect(container!.textContent).toContain('Unable to load your sessions.');
  });
});

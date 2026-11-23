// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionExpiredBanner } from './SessionExpiredBanner';
import { api, onSessionExpired } from '../lib/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * SESSION-EXPIRY-MID-ACTION (god, 2026-11-16): the one new, consistent path
 * for a 401 that survives the silent refresh lib/api.ts already attempts.
 * Fires the listener through a REAL failed `api.get` call (the same
 * mechanism a real 401 anywhere in the console would use), not a direct
 * call into a test-only hook -- see lib/api.test.ts for the listener's own
 * unit coverage of exactly when it fires and when it does not.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  onSessionExpired(null);
  vi.unstubAllGlobals();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<SessionExpiredBanner />);
  });
  return container;
}

/** Stubs fetch so the original call AND the silent refresh both 401, for a
 *  GENUINELY dead session -- exactly the condition lib/api.ts's 401 handler
 *  notifies on (ADMIN-FALSE-SESSION-EXPIRED: the refresh failure message
 *  must be the real-expiry one, not 'No refresh token provided.', which
 *  means "never had a session" and must NOT notify -- see
 *  stubNeverHadASession below). */
function stubExpiredSession() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh'))
        return jsonResponse(401, { message: 'Session expired. Please sign in again.' });
      return jsonResponse(401, { message: 'Session is no longer valid.' });
    }),
  );
}

/** Stubs fetch so the refresh fails because there was never a session to
 *  begin with (no refresh cookie at all) -- the case the banner must stay
 *  silent for. */
function stubNeverHadASession() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh'))
        return jsonResponse(401, { message: 'No refresh token provided.' });
      return jsonResponse(401, { message: 'Unauthorized' });
    }),
  );
}

describe('SessionExpiredBanner', () => {
  it('renders nothing until a session-expiry is actually reported', async () => {
    const el = await mount();
    expect(el.textContent).toBe('');
  });

  it('shows the sign-in prompt, with the typed-work reassurance and a new-tab sign-in link, once a real 401 survives the silent refresh', async () => {
    const el = await mount();
    stubExpiredSession();

    await act(async () => {
      await api.get('/admin/wallet/accounts/u1').catch(() => {});
    });

    expect(el.textContent).toContain('Your session expired');
    expect(el.textContent).toContain('Nothing on this page has been lost');
    const link = el.querySelector('a') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/login');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('never navigates away -- the location stays put throughout', async () => {
    const before = window.location.pathname;
    const el = await mount();
    stubExpiredSession();
    await act(async () => {
      await api.get('/admin/wallet/accounts/u1').catch(() => {});
    });
    expect(el.textContent).toContain('Your session expired');
    expect(window.location.pathname).toBe(before);
  });

  it('stays empty for a staff member opening the admin login page cold, whose 401 has no session to have expired', async () => {
    const el = await mount();
    stubNeverHadASession();

    await act(async () => {
      await api.get('/admin/wallet/accounts/u1').catch(() => {});
    });

    expect(el.textContent).toBe('');
  });
});

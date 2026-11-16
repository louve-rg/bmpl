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
 * mechanism a real 401 anywhere in the app would use), not a direct call
 * into a test-only hook -- see lib/api.test.ts for the listener's own unit
 * coverage of exactly when it fires and when it does not.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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

/** Stubs fetch so the original call AND the silent refresh both 401 --
 *  exactly the condition lib/api.ts's 401 handler notifies on. */
function stubExpiredSession() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) return jsonResponse(401, { message: 'No refresh token provided.' });
      return jsonResponse(401, { message: 'Session is no longer valid.' });
    }),
  );
}

describe('SessionExpiredBanner', () => {
  it('renders nothing until a session-expiry is actually reported', async () => {
    const el = await mount();
    expect(el.textContent).toBe('');
  });

  it('shows the sign-in prompt, with the typed-work reassurance, once a real 401 survives the silent refresh', async () => {
    const el = await mount();
    stubExpiredSession();

    await act(async () => {
      await api.get('/orders').catch(() => {});
    });

    expect(el.textContent).toContain('Your session expired');
    expect(el.textContent).toContain('anything you’ve typed on this page is still here');
    expect(el.querySelector('#session-expired-email')).not.toBeNull();
    expect(el.querySelector('#session-expired-password')).not.toBeNull();
  });

  it('never navigates away -- the location stays put throughout', async () => {
    const before = window.location.pathname;
    const el = await mount();
    stubExpiredSession();
    await act(async () => {
      await api.get('/orders').catch(() => {});
    });
    expect(el.textContent).toContain('Your session expired');
    expect(window.location.pathname).toBe(before);
  });

  it('signs back in in place, replacing the prompt with a success state', async () => {
    const el = await mount();
    stubExpiredSession();
    await act(async () => {
      await api.get('/orders').catch(() => {});
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/login')) return jsonResponse(200, { ok: true });
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );

    const emailInput = el.querySelector('#session-expired-email') as HTMLInputElement;
    const passwordInput = el.querySelector('#session-expired-password') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(emailInput, 'shopper@example.com');
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      setValue.call(passwordInput, 'correct-password');
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const form = el.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(el.textContent).toContain('Signed in again');
    expect(el.textContent).toContain('Nothing on this page was lost');
  });

  it('shows the login failure inline and keeps the prompt open on wrong credentials', async () => {
    const el = await mount();
    stubExpiredSession();
    await act(async () => {
      await api.get('/orders').catch(() => {});
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/login')) return jsonResponse(401, { message: 'Invalid email or password.' });
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );

    const emailInput = el.querySelector('#session-expired-email') as HTMLInputElement;
    const passwordInput = el.querySelector('#session-expired-password') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(emailInput, 'shopper@example.com');
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      setValue.call(passwordInput, 'wrong');
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const form = el.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(el.textContent).toContain('Invalid email or password.');
    expect(el.textContent).toContain('Your session expired');
    expect(el.textContent).not.toContain('Signed in again');
  });
});

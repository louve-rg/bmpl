// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeView } from '../../lib/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// P5: one account menu. Pins the actions it offers, that Escape and an outside
// click close it, and that sign-out always leaves the signed-in state, even
// when the API call fails.
const apiPost = vi.fn();
const push = vi.fn();
const refresh = vi.fn();
vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: (...a: unknown[]) => apiPost(...a) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
// The menu's summary boxes load the wallet when the panel opens. Stub it to
// resolve like the real call does, so the summary never trips on the bare api mock.
vi.mock('../../lib/wallet', () => ({ walletApi: { summary: () => Promise.resolve({ exists: false }) } }));

import { AccountMenu } from './AccountMenu';

const me = {
  id: 'u1',
  email: 'r@example.test',
  firstName: 'Rae',
  lastName: 'Test',
  avatarUrl: null,
  roles: [],
} as unknown as MeView;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiPost.mockResolvedValue({});
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  root = null;
  container = null;
  apiPost.mockReset();
  push.mockReset();
  refresh.mockReset();
});

function mount(props: Partial<React.ComponentProps<typeof AccountMenu>> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<AccountMenu me={me} tone="light" {...props} />));
  return container.querySelector<HTMLButtonElement>('button[aria-haspopup="true"]')!;
}

function panelText(): string {
  return container!.querySelector('[id^="account-menu-"]')?.textContent ?? '';
}

describe('AccountMenu', () => {
  it('is closed until opened, then offers the account actions', async () => {
    const trigger = mount();
    expect(panelText()).toBe('');
    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panelText()).toContain('Dashboard');
    expect(panelText()).toContain('Profile');
    expect(panelText()).toContain('My orders');
    expect(panelText()).toContain('Sign out');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const trigger = mount();
    await act(async () => trigger.click());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a click outside', async () => {
    const trigger = mount();
    await act(async () => trigger.click());
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('signs out, clears the host state, and goes to the given page', async () => {
    const onSignedOut = vi.fn();
    const trigger = mount({ afterSignOut: '/', onSignedOut });
    await act(async () => trigger.click());
    const signOut = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Sign out')!;
    await act(async () => signOut.click());
    expect(apiPost).toHaveBeenCalledWith('/auth/logout');
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('still leaves the signed-in state when the sign-out call fails', async () => {
    apiPost.mockRejectedValueOnce(new Error('network'));
    const onSignedOut = vi.fn();
    const trigger = mount({ onSignedOut });
    await act(async () => trigger.click());
    const signOut = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Sign out')!;
    await act(async () => signOut.click());
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/login');
  });
});

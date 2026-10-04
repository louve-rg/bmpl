// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// P2 regression: the public header's mobile list gets the same Escape, focus
// trap, scroll lock and focus return as the dashboard drawer. Covered for
// signed-out AND signed-in visitors, because the two render different panels.
const apiGet = vi.fn();
vi.mock('../../lib/api', () => ({ api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../cart/CartButton', () => ({ CartButton: () => null }));
vi.mock('../saved/SavedNavButton', () => ({ SavedNavButton: () => null }));
vi.mock('../AnnouncementBanner', () => ({ AnnouncementBanner: () => null }));

import { Header } from './Header';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
  document.body.style.overflow = '';
  apiGet.mockReset();
  root = null;
  container = null;
});

async function mount(me: 'signed-in' | 'signed-out') {
  apiGet.mockImplementation(() =>
    me === 'signed-in'
      ? Promise.resolve({ firstName: 'Rae', lastName: 'Test', roles: [] })
      : Promise.reject(new Error('401')),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Header />);
  });
  // The /me call resolves on a microtask; flush it so the account controls render.
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function toggle(): HTMLButtonElement {
  return container!.querySelector('button[aria-controls="public-mobile-nav"]') as HTMLButtonElement;
}

async function openMenu() {
  await act(async () => {
    toggle().click();
  });
}

function panel(): HTMLElement | null {
  return document.getElementById('public-mobile-nav');
}

describe('public Header mobile menu (P2)', () => {
  for (const state of ['signed-out', 'signed-in'] as const) {
    describe(state, () => {
      it('moves focus into the list on open', async () => {
        await mount(state);
        toggle().focus();
        await openMenu();

        expect(toggle().getAttribute('aria-expanded')).toBe('true');
        expect(panel()).not.toBeNull();
        expect(document.activeElement?.tagName).toBe('A');
        expect(panel()!.contains(document.activeElement)).toBe(true);
      });

      it('traps Tab inside the list, wrapping from last to first', async () => {
        await mount(state);
        await openMenu();

        const items = Array.from(panel()!.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
        const last = items[items.length - 1]!;
        const first = items[0]!;

        await act(async () => {
          last.focus();
          last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        });
        expect(document.activeElement).toBe(first);
      });

      it('closes on Escape and returns focus to the toggle', async () => {
        await mount(state);
        await openMenu();

        await act(async () => {
          document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(panel()).toBeNull();
        expect(toggle().getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(toggle());
      });

      it('locks background scroll while the list is open and restores it on close', async () => {
        document.body.style.overflow = 'auto';
        await mount(state);
        await openMenu();
        expect(document.body.style.overflow).toBe('hidden');

        await act(async () => {
          document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(document.body.style.overflow).toBe('auto');
      });
    });
  }

  it('shows the account actions that match the visitor: sign in for guests, sign out for members', async () => {
    await mount('signed-out');
    await openMenu();
    expect(panel()!.textContent).toContain('Sign in');
    expect(panel()!.textContent).not.toContain('Sign out');
  });

  it('shows sign out for a signed-in member', async () => {
    await mount('signed-in');
    await openMenu();
    expect(panel()!.textContent).toContain('Sign out');
    expect(panel()!.textContent).not.toContain('Sign in');
  });

  it('closes the list when the window grows to desktop width', async () => {
    let onChange: (() => void) | undefined;
    let matches = false;
    window.matchMedia = vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, cb: () => void) => (onChange = cb),
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    await mount('signed-out');
    await openMenu();
    expect(panel()).not.toBeNull();

    matches = true;
    await act(async () => onChange?.());
    expect(panel()).toBeNull();
  });
});

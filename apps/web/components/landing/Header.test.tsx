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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => window.location.pathname }));
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

  it('shows sign out for a signed-in member, inside the account menu', async () => {
    await mount('signed-in');
    await openMenu();
    // Guard: the mobile list rendered and holds the account menu.
    expect(panel()!.textContent).toContain('Rae');
    expect(panel()!.textContent).not.toContain('Sign in');
    expect(panel()!.textContent).not.toContain('Sign out');
    const trigger = panel()!.querySelector<HTMLButtonElement>('button[aria-haspopup="true"]')!;
    await act(async () => trigger.click());
    expect(panel()!.textContent).toContain('Sign out');
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

describe('public Header desktop groups (P6 disclosures)', () => {
  function group(heading: string): HTMLDetailsElement {
    const summary = Array.from(container!.querySelectorAll('summary')).find((s) => s.textContent?.startsWith(heading));
    return summary!.parentElement as HTMLDetailsElement;
  }

  it('Escape closes an open group and returns focus to its summary', async () => {
    await mount('signed-out');
    const commerce = group('Commerce');
    // Guard: the group rendered with its real links before the behaviour is asserted.
    expect(commerce.textContent).toContain('Marketplace');
    await act(async () => {
      commerce.open = true;
      commerce.dispatchEvent(new Event('toggle'));
    });
    expect(commerce.open).toBe(true);
    await act(async () => {
      document.querySelector<HTMLAnchorElement>('details[open] a')!.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(commerce.open).toBe(false);
    expect(document.activeElement).toBe(commerce.querySelector('summary'));
  });

  it('a click outside closes an open group', async () => {
    await mount('signed-out');
    const commerce = group('Commerce');
    await act(async () => {
      commerce.open = true;
      commerce.dispatchEvent(new Event('toggle'));
    });
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(commerce.open).toBe(false);
  });

  it('opening one group closes the others, so only one dropdown is open', async () => {
    await mount('signed-out');
    const commerce = group('Commerce');
    const transport = group('Transport');
    await act(async () => {
      commerce.open = true;
      commerce.dispatchEvent(new Event('toggle'));
    });
    await act(async () => {
      transport.open = true;
      transport.dispatchEvent(new Event('toggle'));
    });
    expect(transport.open).toBe(true);
    expect(commerce.open).toBe(false);
  });

  describe('mobile list closes on an outside press (the gap found live)', () => {
    it('a press outside the list closes it', async () => {
      await mount('signed-out');
      await openMenu();
      expect(panel()).not.toBeNull();
      await act(async () => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(panel()).toBeNull();
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    it('a touch outside the list closes it too', async () => {
      await mount('signed-out');
      await openMenu();
      await act(async () => {
        document.body.dispatchEvent(new Event('touchstart', { bubbles: true }));
      });
      expect(panel()).toBeNull();
    });

    it('a press on the toggle does not close it; the toggle click itself does, once', async () => {
      await mount('signed-out');
      await openMenu();
      await act(async () => {
        toggle().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(panel()).not.toBeNull();
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      await act(async () => {
        toggle().click();
      });
      expect(panel()).toBeNull();
    });

    it('a press inside the list does not close it', async () => {
      await mount('signed-out');
      await openMenu();
      const link = panel()!.querySelector('a')!;
      await act(async () => {
        link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
      expect(panel()).not.toBeNull();
    });
  });

  describe('active page (aria-current, not colour alone)', () => {
    afterEach(() => {
      window.history.replaceState({}, '', '/');
    });

    function link(label: string): HTMLAnchorElement {
      return Array.from(container!.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent?.trim() === label)!;
    }

    it('marks the leaf that is the current page, and only that one', async () => {
      window.history.replaceState({}, '', '/products');
      await mount('signed-out');
      expect(link('Marketplace').getAttribute('aria-current')).toBe('page');
      expect(link('Vendors').getAttribute('aria-current')).toBeNull();
      expect(link('Orders').getAttribute('aria-current')).toBeNull();
    });

    it('lights the parent group on a nested route (a product page lights Commerce)', async () => {
      window.history.replaceState({}, '', '/products/some-product');
      await mount('signed-out');
      expect(group('Commerce').querySelector('summary')!.getAttribute('aria-current')).toBe('true');
      expect(link('Marketplace').getAttribute('aria-current')).toBeNull();
    });

    it('tells Sale and Rent apart on the same path by their query', async () => {
      window.history.replaceState({}, '', '/properties?purpose=FOR_RENT');
      await mount('signed-out');
      expect(link('Rent').getAttribute('aria-current')).toBe('page');
      expect(link('Sale').getAttribute('aria-current')).toBeNull();
      expect(group('Real Estate').querySelector('summary')!.getAttribute('aria-current')).toBe('true');
    });

    it('marks no group on a page outside the nav', async () => {
      window.history.replaceState({}, '', '/login');
      await mount('signed-out');
      for (const s of Array.from(container!.querySelectorAll('summary'))) {
        expect(s.getAttribute('aria-current')).toBeNull();
      }
      expect(container!.querySelectorAll('[aria-current="page"]').length).toBe(0);
    });

    it('the mobile list shows the same current item', async () => {
      window.history.replaceState({}, '', '/shipping');
      await mount('signed-out');
      await openMenu();
      const mobileShipping = Array.from(panel()!.querySelectorAll('a')).find((a) => a.textContent?.trim() === 'Shipping & Delivery')!;
      expect(mobileShipping.getAttribute('aria-current')).toBe('page');
    });
  });
});

// The menu is taller than a phone screen and the page behind it is locked, so the
// menu itself must scroll (Edward's live report: he could not scroll at all). jsdom
// has no layout, so this pins the classes that make it scroll; the scrolling itself
// is measured in a browser against the live site.
describe('public Header mobile menu scrolls inside the screen', () => {
  for (const state of ['signed-out', 'signed-in'] as const) {
    it(`the open list is bounded to the screen and scrolls itself (${state})`, async () => {
      await mount(state);
      await openMenu();
      const cls = panel()!.className;
      expect(cls).toContain('overflow-y-auto');
      expect(cls).toContain('overscroll-contain');
      expect(cls).toContain('max-h-[calc(100vh-4rem)]');
      expect(cls).toContain('supports-[height:100dvh]:max-h-[calc(100dvh-4rem)]');
    });
  }
});

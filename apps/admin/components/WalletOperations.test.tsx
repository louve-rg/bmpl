// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalletOperations } from './WalletOperations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-280, extended by SHIPPING-E2E-CLOSE: WalletOperations (BMPL-270) gates
 * THREE independent, highly restricted permissions -- wallet.credit_test,
 * wallet.reconcile and wallet.lock -- none in any standing bundle. A reader
 * holding one must see exactly that one card and not the others.
 *
 * NO "read-only info still renders" assertion here, by design, not oversight:
 * this component has no informational content of its own for a non-holder —
 * it is three write forms and nothing else (its own docstring: "anyone who
 * could view the wallet page also saw both money-creation forms rendered,
 * whether or not they held either restricted permission" was the defect;
 * the fix is that a non-holder now sees NOTHING from this component, which
 * is correct here specifically because none of the three permissions has a
 * report half to preserve — unlike a hub's hours or a route's schedule.
 */

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

interface Account {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}
interface WalletAccountRow {
  id: string;
  type: string;
  status: string;
  currency: string;
  cachedBalanceMinor: number;
}

/** Same as stubFetch, plus the account-lookup, wallet-accounts and write
 * routes the confirm-before-write cards (SHIPPING-E2E-CLOSE) exercise. */
function stubFetchFull(
  adminPermissions: string[],
  opts: {
    users?: Record<string, Account>;
    walletAccounts?: Record<string, WalletAccountRow[]>;
  } = {},
) {
  const users = opts.users ?? {};
  const walletAccounts = opts.walletAccounts ?? {};
  const posts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });

      const walletAccountsMatch = url.match(/\/api\/admin\/wallet\/users\/([^/?]+)\/accounts$/);
      if (walletAccountsMatch && (!init?.method || init.method === 'GET')) {
        const rows = walletAccounts[decodeURIComponent(walletAccountsMatch[1] ?? '')];
        return rows ? jsonResponse(200, rows) : jsonResponse(404, { message: 'User not found.' });
      }

      const lockMatch = url.match(/\/api\/admin\/wallet\/users\/([^/?]+)\/(lock|unlock)$/);
      if (lockMatch && init?.method === 'POST') {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        posts.push({ url, body });
        const action = lockMatch[2];
        return jsonResponse(200, { userId: lockMatch[1], status: action === 'lock' ? 'LOCKED' : 'ACTIVE', walletAccountsChanged: 1 });
      }

      const userMatch = url.match(/\/api\/admin\/users\/([^/?]+)$/);
      if (userMatch && (!init?.method || init.method === 'GET')) {
        const account = users[decodeURIComponent(userMatch[1] ?? '')];
        return account ? jsonResponse(200, account) : jsonResponse(404, { message: 'User not found.' });
      }

      if (url.includes('/api/admin/wallet/test-credit') && init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse(200, { availableMinor: 9000 });
      }

      return jsonResponse(404, { message: 'not mocked: ' + url });
    }),
  );
  return posts;
}

// Same convention as apps/web/app/dashboard/shipments/new/page.test.tsx: the
// prototype's native setter bypasses React's own value-tracker, and the
// dispatch is wrapped in act() so the resulting state update is flushed
// before the next assertion rather than left pending.
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;

function setValue(el: HTMLInputElement, value: string) {
  act(() => {
    nativeInputValueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function clickButton(text: string) {
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button with text "${text}"`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  container = document.getElementById('root') as HTMLDivElement;
  root = createRoot(container);
  await act(async () => {
    root!.render(<WalletOperations />);
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

describe('WalletOperations — three independent permissions (BMPL-280)', () => {
  it('a reader with none of the three permissions sees nothing at all — no card, no button, zero disabled buttons', async () => {
    stubFetch(['wallet.read']);
    await mount();

    expect(document.body.textContent?.trim()).toBe('');
    expect(buttonTexts().length).toBe(0);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
  });

  it('wallet.credit_test alone shows the test-credit card but neither other card', async () => {
    stubFetch(['wallet.credit_test']);
    await mount();

    expect(document.body.textContent).toMatch(/Administrative test credit/);
    expect(document.body.textContent).not.toMatch(/Release stale wallet holds/);
    expect(document.body.textContent).not.toMatch(/Wallet lock/);
    expect(buttonTexts().some((t) => t.includes('test credit'))).toBe(true);
  });

  it('wallet.reconcile alone shows the stale-hold card but neither other card', async () => {
    stubFetch(['wallet.reconcile']);
    await mount();

    expect(document.body.textContent).toMatch(/Release stale wallet holds/);
    expect(document.body.textContent).not.toMatch(/Administrative test credit/);
    expect(document.body.textContent).not.toMatch(/Wallet lock/);
    expect(buttonTexts()).toContain('Release stale holds');
  });

  it('wallet.lock alone shows the wallet-lock card but neither other card', async () => {
    stubFetch(['wallet.lock']);
    await mount();

    expect(document.body.textContent).toMatch(/Wallet lock/);
    expect(document.body.textContent).not.toMatch(/Administrative test credit/);
    expect(document.body.textContent).not.toMatch(/Release stale wallet holds/);
  });

  it('holding all three shows all three cards', async () => {
    stubFetch(['wallet.credit_test', 'wallet.reconcile', 'wallet.lock']);
    await mount();

    expect(document.body.textContent).toMatch(/Administrative test credit/);
    expect(document.body.textContent).toMatch(/Release stale wallet holds/);
    expect(document.body.textContent).toMatch(/Wallet lock/);
  });
});

/**
 * SHIPPING-E2E-CLOSE: the test-credit card used to post straight from a raw,
 * unverified id. It must now resolve the id to a name and email through the
 * admin console's existing account lookup before the amount/reason fields
 * unlock, and the submit button must name the resolved account -- an
 * operator can no longer credit an account they have not been shown.
 */
describe('TestCreditCard -- confirm-before-credit (SHIPPING-E2E-CLOSE)', () => {
  it('locks amount and reason until the typed id resolves, then names the account on the confirm button', async () => {
    stubFetchFull(['wallet.credit_test'], { users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } } });
    await mount();

    const amountInput = document.getElementById('tc-amount') as HTMLInputElement;
    const reasonInput = document.getElementById('tc-reason') as HTMLInputElement;
    expect(amountInput.disabled).toBe(true);
    expect(reasonInput.disabled).toBe(true);
    expect(document.body.textContent).not.toMatch(/This will credit/);

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();

    expect(document.body.textContent).toMatch(/This will credit\s*Jane Doe\s*\(jane@example\.com\)/);
    expect(amountInput.disabled).toBe(false);
    expect(reasonInput.disabled).toBe(false);
    expect(buttonTexts().some((t) => t.includes('Confirm: credit') && t.includes('Jane Doe'))).toBe(true);
  });

  it('posts the resolved account id, never a raw typed value, once confirmed', async () => {
    const posts = stubFetchFull(['wallet.credit_test'], { users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } } });
    await mount();

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();
    setValue(document.getElementById('tc-reason') as HTMLInputElement, 'UAT testing');
    await flush();
    clickButton('Confirm: credit $80.00 to Jane Doe');
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ userId: 'u1', amountMinor: 8000, reason: 'UAT testing' });
    expect(document.body.textContent).toMatch(/Posted \$80\.00 to Jane Doe/);
  });

  it('editing the id after a successful lookup clears the resolution and re-locks the form', async () => {
    stubFetchFull(['wallet.credit_test'], { users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } } });
    await mount();

    const userInput = document.getElementById('tc-user') as HTMLInputElement;
    setValue(userInput, 'u1');
    await flush();
    clickButton('Look up');
    await flush();
    expect(document.body.textContent).toMatch(/This will credit/);

    setValue(userInput, 'u1x');
    await flush();

    expect(document.body.textContent).not.toMatch(/This will credit/);
    expect((document.getElementById('tc-amount') as HTMLInputElement).disabled).toBe(true);
  });

  it('an id that does not resolve shows a lookup error and never unlocks the form', async () => {
    stubFetchFull(['wallet.credit_test'], { users: {} });
    await mount();

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'does-not-exist');
    await flush();
    clickButton('Look up');
    await flush();

    expect(document.body.textContent).toMatch(/User not found\./);
    expect((document.getElementById('tc-amount') as HTMLInputElement).disabled).toBe(true);
  });
});

/**
 * SHIPPING-E2E-CLOSE: the wallet-lock card (BMPL-232 owner ruling 4), exposed
 * for the first time. Same confirm-before-write shape as TestCreditCard, plus
 * the direction-aware behaviour specific to a lock: the card must show the
 * CURRENT status via the new read-only GET /admin/wallet/users/:id/accounts,
 * and the confirm button must name the direction (lock vs unlock) as well as
 * the person.
 */
describe('WalletLockCard -- confirm-before-lock, direction-aware (SHIPPING-E2E-CLOSE)', () => {
  it('an ACTIVE wallet resolves to a LOCK offer naming the person, and shows balance/status', async () => {
    stubFetchFull(['wallet.lock'], {
      users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } },
      walletAccounts: { u1: [{ id: 'wa1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 1500 }] },
    });
    await mount();

    const reasonInput = document.getElementById('wl-reason') as HTMLInputElement;
    expect(reasonInput.disabled).toBe(true);

    setValue(document.getElementById('wl-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();

    expect(document.body.textContent).toMatch(/Jane Doe/);
    expect(document.body.textContent).toMatch(/\$15\.00/);
    expect(reasonInput.disabled).toBe(false);
    expect(buttonTexts().some((t) => t === "Confirm: lock Jane Doe's wallet")).toBe(true);
    expect(buttonTexts().some((t) => t.includes('unlock'))).toBe(false);
  });

  it('a LOCKED wallet resolves to an UNLOCK offer instead', async () => {
    stubFetchFull(['wallet.lock'], {
      users: { u2: { id: 'u2', firstName: 'John', lastName: 'Roe', email: 'john@example.com' } },
      walletAccounts: { u2: [{ id: 'wa2', type: 'USER', status: 'LOCKED', currency: 'BZD', cachedBalanceMinor: 0 }] },
    });
    await mount();

    setValue(document.getElementById('wl-user') as HTMLInputElement, 'u2');
    await flush();
    clickButton('Look up');
    await flush();

    expect(buttonTexts().some((t) => t === "Confirm: unlock John Roe's wallet")).toBe(true);
  });

  it('a SUSPENDED wallet shows the status but offers no action either way', async () => {
    stubFetchFull(['wallet.lock'], {
      users: { u3: { id: 'u3', firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' } },
      walletAccounts: { u3: [{ id: 'wa3', type: 'USER', status: 'SUSPENDED', currency: 'BZD', cachedBalanceMinor: 0 }] },
    });
    await mount();

    setValue(document.getElementById('wl-user') as HTMLInputElement, 'u3');
    await flush();
    clickButton('Look up');
    await flush();

    expect(document.body.textContent).toMatch(/suspension is not managed by the lock control/);
    expect(buttonTexts().some((t) => t.startsWith('Confirm: lock') || t.startsWith('Confirm: unlock'))).toBe(false);
    expect((document.getElementById('wl-reason') as HTMLInputElement).disabled).toBe(true);
  });

  it('posts to the resolved id and the direction matching current status, naming both in the confirm', async () => {
    const posts = stubFetchFull(['wallet.lock'], {
      users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } },
      walletAccounts: { u1: [{ id: 'wa1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 1500 }] },
    });
    await mount();

    setValue(document.getElementById('wl-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();
    setValue(document.getElementById('wl-reason') as HTMLInputElement, 'Suspected fraud, case #412');
    await flush();
    clickButton("Confirm: lock Jane Doe's wallet");
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/admin\/wallet\/users\/u1\/lock$/);
    expect(posts[0]?.body).toMatchObject({ reason: 'Suspected fraud, case #412' });
    expect(document.body.textContent).toMatch(/Locked Jane Doe's wallet\. Status is now LOCKED\./);
  });

  it('a user with no USER wallet account offers no action', async () => {
    stubFetchFull(['wallet.lock'], {
      users: { u4: { id: 'u4', firstName: 'No', lastName: 'Wallet', email: 'no-wallet@example.com' } },
      walletAccounts: { u4: [] },
    });
    await mount();

    setValue(document.getElementById('wl-user') as HTMLInputElement, 'u4');
    await flush();
    clickButton('Look up');
    await flush();

    expect(document.body.textContent).toMatch(/has no wallet account to lock/);
    expect(buttonTexts().some((t) => t.startsWith('Confirm: lock') || t.startsWith('Confirm: unlock'))).toBe(false);
  });

  it('editing the id after a successful lookup clears the resolution and re-locks the form', async () => {
    stubFetchFull(['wallet.lock'], {
      users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } },
      walletAccounts: { u1: [{ id: 'wa1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 1500 }] },
    });
    await mount();

    const userInput = document.getElementById('wl-user') as HTMLInputElement;
    setValue(userInput, 'u1');
    await flush();
    clickButton('Look up');
    await flush();
    expect(document.body.textContent).toMatch(/Jane Doe/);

    setValue(userInput, 'u1x');
    await flush();

    expect(document.body.textContent).not.toMatch(/wallet status/);
    expect((document.getElementById('wl-reason') as HTMLInputElement).disabled).toBe(true);
  });
});

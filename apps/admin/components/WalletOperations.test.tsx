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

/** Same as stubFetch, plus the account-lookup, name/email search,
 * wallet-accounts and write routes the confirm-before-write cards
 * (SHIPPING-E2E-CLOSE, ADMIN-WALLET-LOOKUP) exercise. */
function stubFetchFull(
  adminPermissions: string[],
  opts: {
    users?: Record<string, Account>;
    walletAccounts?: Record<string, WalletAccountRow[]>;
    search?: Record<string, Account[]>;
  } = {},
) {
  const users = opts.users ?? {};
  const walletAccounts = opts.walletAccounts ?? {};
  const search = opts.search ?? {};
  const posts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions });

      const searchMatch = url.match(/\/api\/admin\/users\?(.*)$/);
      if (searchMatch && (!init?.method || init.method === 'GET')) {
        const q = new URLSearchParams(searchMatch[1]).get('query') ?? '';
        const items = search[q] ?? [];
        return jsonResponse(200, { total: items.length, items });
      }

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

/** A search-result row's two spans sit on separate JSX lines, so their
 * combined textContent has no space between name and email -- match by
 * substring/regex rather than an exact string. */
function clickButtonMatching(pattern: RegExp) {
  const btn = Array.from(document.body.querySelectorAll('button')).find((b) => pattern.test(b.textContent ?? ''));
  if (!btn) throw new Error(`no button matching ${pattern}`);
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
 * MDF-499, R1 + R2: a link back to the resolved customer's
 * own profile (so an admin working the wallet screen is not stuck searching
 * for the same person again), and the server-mirrored amount ceiling --
 * ADMIN_TEST_CREDIT_MAX_MINOR, BZD 1,000, a pre-existing financial-safety
 * control (a1ad2114) that was invisible rather than absent -- the real
 * defect. The real check is server-side; this is a round-trip-saving hint
 * that must quote the exact same number.
 */
describe('TestCreditCard -- profile link and amount ceiling (MDF-499)', () => {
  it('links back to the resolved customer\'s own profile page', async () => {
    stubFetchFull(['wallet.credit_test'], { users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } } });
    await mount();

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();

    const links = Array.from(document.body.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/dashboard/users/u1');
  });

  it('refuses an amount over the ceiling with a warning, and the button never offers to post it', async () => {
    stubFetchFull(['wallet.credit_test'], { users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } } });
    await mount();

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();
    setValue(document.getElementById('tc-amount') as HTMLInputElement, '1000.01');
    setValue(document.getElementById('tc-reason') as HTMLInputElement, 'Over the line');
    await flush();

    expect(document.body.textContent).toMatch(/cannot exceed \$1000\.00/);
    const confirmBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Confirm: credit'));
    expect(confirmBtn?.disabled).toBe(true);
  });

  it('allows exactly the ceiling amount', async () => {
    const posts = stubFetchFull(['wallet.credit_test'], { users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } } });
    await mount();

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();
    setValue(document.getElementById('tc-amount') as HTMLInputElement, '1000.00');
    setValue(document.getElementById('tc-reason') as HTMLInputElement, 'At the line');
    await flush();
    clickButton('Confirm: credit $1000.00 to Jane Doe');
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ amountMinor: 100_000 });
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

/**
 * ADMIN-WALLET-LOOKUP: an administrator must be able to find a customer by
 * name or email in both wallet cards, without ever hand-typing a user id.
 * This reuses the Users page's own search (GET /admin/users?query=) and
 * must not weaken #553's guards: the submit handler still refuses until an
 * account is resolved, the posted body still carries the resolved id (never
 * a raw value), and the lock card still derives its offered direction from
 * current status.
 */
describe('TestCreditCard -- name/email search (ADMIN-WALLET-LOOKUP)', () => {
  it('a search with several matches lists all of them, and the form stays locked until one is picked', async () => {
    stubFetchFull(['wallet.credit_test'], {
      search: {
        jane: [
          { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
          { id: 'u2', firstName: 'Jane', lastName: 'Smith', email: 'jane.smith@example.com' },
        ],
      },
    });
    await mount();

    const amountInput = document.getElementById('tc-amount') as HTMLInputElement;
    expect(amountInput.disabled).toBe(true);

    setValue(document.getElementById('tc-search') as HTMLInputElement, 'jane');
    await flush();
    clickButton('Search');
    await flush();

    expect(document.body.textContent).toMatch(/Jane Doe/);
    expect(document.body.textContent).toMatch(/Jane Smith/);
    // Two results on screen and neither picked yet -- the credit-posting
    // guard must still refuse: the button names no one and the fields stay
    // locked, exactly as it does before any id lookup ever runs.
    expect(amountInput.disabled).toBe(true);
    expect(buttonTexts().some((t) => t.startsWith('Confirm: credit'))).toBe(false);
  });

  it('picking a search result resolves the account without ever typing an id, and posts that resolved id', async () => {
    const posts = stubFetchFull(['wallet.credit_test'], {
      search: { jane: [{ id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }] },
    });
    await mount();

    setValue(document.getElementById('tc-search') as HTMLInputElement, 'jane');
    await flush();
    clickButton('Search');
    await flush();
    clickButtonMatching(/Jane Doe.*jane@example\.com/);
    await flush();

    // The id field now reflects the pick -- never hand-typed -- and the
    // same confirm-before-write guard from #553 governs from here on.
    expect((document.getElementById('tc-user') as HTMLInputElement).value).toBe('u1');
    expect(document.body.textContent).toMatch(/This will credit\s*Jane Doe\s*\(jane@example\.com\)/);
    expect((document.getElementById('tc-amount') as HTMLInputElement).disabled).toBe(false);

    setValue(document.getElementById('tc-reason') as HTMLInputElement, 'UAT testing');
    await flush();
    clickButton('Confirm: credit $80.00 to Jane Doe');
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ userId: 'u1', reason: 'UAT testing' });
  });

  it('a search with no matches reports it and leaves the form locked', async () => {
    stubFetchFull(['wallet.credit_test'], { search: {} });
    await mount();

    setValue(document.getElementById('tc-search') as HTMLInputElement, 'nobody');
    await flush();
    clickButton('Search');
    await flush();

    expect(document.body.textContent).toMatch(/No matching accounts\./);
    expect((document.getElementById('tc-amount') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('WalletLockCard -- name/email search (ADMIN-WALLET-LOOKUP)', () => {
  it('a search with several matches lists all of them, and the form stays locked until one is picked', async () => {
    stubFetchFull(['wallet.lock'], {
      search: {
        jane: [
          { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
          { id: 'u2', firstName: 'Jane', lastName: 'Smith', email: 'jane.smith@example.com' },
        ],
      },
    });
    await mount();

    setValue(document.getElementById('wl-search') as HTMLInputElement, 'jane');
    await flush();
    clickButton('Search');
    await flush();

    expect(document.body.textContent).toMatch(/Jane Doe/);
    expect(document.body.textContent).toMatch(/Jane Smith/);
    expect((document.getElementById('wl-reason') as HTMLInputElement).disabled).toBe(true);
    expect(buttonTexts().some((t) => t.startsWith('Confirm: lock') || t.startsWith('Confirm: unlock'))).toBe(false);
  });

  it('picking a search result fetches wallet status and still derives the offered direction from it, never asked for', async () => {
    const posts = stubFetchFull(['wallet.lock'], {
      search: { jane: [{ id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }] },
      walletAccounts: { u1: [{ id: 'wa1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 1500 }] },
    });
    await mount();

    setValue(document.getElementById('wl-search') as HTMLInputElement, 'jane');
    await flush();
    clickButton('Search');
    await flush();
    clickButtonMatching(/Jane Doe.*jane@example\.com/);
    await flush();

    expect((document.getElementById('wl-user') as HTMLInputElement).value).toBe('u1');
    expect(document.body.textContent).toMatch(/\$15\.00/);
    expect(buttonTexts().some((t) => t === "Confirm: lock Jane Doe's wallet")).toBe(true);
    expect(buttonTexts().some((t) => t.includes('unlock'))).toBe(false);

    setValue(document.getElementById('wl-reason') as HTMLInputElement, 'Suspected fraud, case #412');
    await flush();
    clickButton("Confirm: lock Jane Doe's wallet");
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/admin\/wallet\/users\/u1\/lock$/);
  });
});

/**
 * MDF-499: the owner's usability review of #559's merged
 * search found three gaps rather than one -- a resolved customer surviving
 * the search text changing underneath it (the stale-selection bug), no
 * explicit way to abandon a selection, and no wallet status/balance shown
 * for the credit card the way the lock card already shows it. None of
 * these loosen any #553 guard: the submit-handler check, the resolved id in
 * the posted body and the status-derived lock direction are untouched.
 */
describe('TestCreditCard -- wallet status/balance before posting, stale selection, clear (MDF-499)', () => {
  it('shows current wallet status and balance once resolved, and leaves the credit enabled for an ACTIVE wallet', async () => {
    stubFetchFull(['wallet.credit_test'], {
      users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } },
      walletAccounts: { u1: [{ id: 'wa1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 1500 }] },
    });
    await mount();

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();

    expect(document.body.textContent).toMatch(/Wallet status\s*ACTIVE/);
    expect(document.body.textContent).toMatch(/\$15\.00/);
    expect((document.getElementById('tc-amount') as HTMLInputElement).disabled).toBe(false);
  });

  it('a LOCKED wallet is shown and the credit is blocked, rather than discovered only after a failed post', async () => {
    stubFetchFull(['wallet.credit_test'], {
      users: { u2: { id: 'u2', firstName: 'John', lastName: 'Roe', email: 'john@example.com' } },
      walletAccounts: { u2: [{ id: 'wa2', type: 'USER', status: 'LOCKED', currency: 'BZD', cachedBalanceMinor: 0 }] },
    });
    await mount();

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'u2');
    await flush();
    clickButton('Look up');
    await flush();
    setValue(document.getElementById('tc-reason') as HTMLInputElement, 'UAT testing');
    await flush();

    expect(document.body.textContent).toMatch(/This wallet is locked; a test credit cannot be posted/);
    const confirmBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Confirm: credit')) as
      | HTMLButtonElement
      | undefined;
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn!.disabled).toBe(true);
  });

  it('a brand-new customer with no wallet account yet stays creditable -- the account is created on first credit', async () => {
    stubFetchFull(['wallet.credit_test'], {
      users: { u3: { id: 'u3', firstName: 'New', lastName: 'Person', email: 'new@example.com' } },
      walletAccounts: { u3: [] },
    });
    await mount();

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'u3');
    await flush();
    clickButton('Look up');
    await flush();

    expect(document.body.textContent).toMatch(/No wallet account yet/);
    expect((document.getElementById('tc-amount') as HTMLInputElement).disabled).toBe(false);
  });

  it('a resolved customer does not survive the search text changing underneath them', async () => {
    stubFetchFull(['wallet.credit_test'], {
      search: { jane: [{ id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }] },
      walletAccounts: { u1: [{ id: 'wa1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 1500 }] },
    });
    await mount();

    setValue(document.getElementById('tc-search') as HTMLInputElement, 'jane');
    await flush();
    clickButton('Search');
    await flush();
    clickButtonMatching(/Jane Doe.*jane@example\.com/);
    await flush();
    expect(document.body.textContent).toMatch(/This will credit/);

    setValue(document.getElementById('tc-search') as HTMLInputElement, 'jan');
    await flush();

    expect(document.body.textContent).not.toMatch(/This will credit/);
    expect((document.getElementById('tc-amount') as HTMLInputElement).disabled).toBe(true);
  });

  it('"Clear" abandons a resolved selection and re-locks the form, rather than relying only on editing the id', async () => {
    stubFetchFull(['wallet.credit_test'], {
      users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } },
      walletAccounts: { u1: [] },
    });
    await mount();

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();
    expect(document.body.textContent).toMatch(/This will credit/);

    clickButton('Clear');
    await flush();

    expect(document.body.textContent).not.toMatch(/This will credit/);
    expect((document.getElementById('tc-user') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('tc-amount') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('WalletLockCard -- stale selection, loading state, clear (MDF-499)', () => {
  it('a resolved customer does not survive the search text changing underneath them', async () => {
    stubFetchFull(['wallet.lock'], {
      search: { jane: [{ id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }] },
      walletAccounts: { u1: [{ id: 'wa1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 1500 }] },
    });
    await mount();

    setValue(document.getElementById('wl-search') as HTMLInputElement, 'jane');
    await flush();
    clickButton('Search');
    await flush();
    clickButtonMatching(/Jane Doe.*jane@example\.com/);
    await flush();
    expect(document.body.textContent).toMatch(/wallet status/);

    setValue(document.getElementById('wl-search') as HTMLInputElement, 'jan');
    await flush();

    expect(document.body.textContent).not.toMatch(/wallet status/);
    expect((document.getElementById('wl-reason') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows a loading state, never the false "no wallet account" warning, while the status read is still in flight after a pick', async () => {
    const pending: { resolveAccounts: ((rows: unknown) => void) | null } = { resolveAccounts: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['wallet.lock'] });
        const searchMatch = url.match(/\/api\/admin\/users\?(.*)$/);
        if (searchMatch && (!init?.method || init.method === 'GET')) {
          return jsonResponse(200, { total: 1, items: [{ id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }] });
        }
        const walletAccountsMatch = url.match(/\/api\/admin\/wallet\/users\/([^/?]+)\/accounts$/);
        if (walletAccountsMatch && (!init?.method || init.method === 'GET')) {
          return new Promise((resolve) => {
            pending.resolveAccounts = (rows) => resolve(jsonResponse(200, rows));
          });
        }
        return jsonResponse(404, { message: 'not mocked: ' + url });
      }),
    );
    await mount();

    setValue(document.getElementById('wl-search') as HTMLInputElement, 'jane');
    await flush();
    clickButton('Search');
    await flush();
    clickButtonMatching(/Jane Doe.*jane@example\.com/);
    await flush();

    // The wallet-accounts read has not come back yet -- the false reading
    // ("no account") must not render before the true one is even known.
    expect(document.body.textContent).toMatch(/Checking current wallet status/);
    expect(document.body.textContent).not.toMatch(/has no wallet account to lock/);

    pending.resolveAccounts?.([{ id: 'wa1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 1500 }]);
    await flush();

    expect(document.body.textContent).not.toMatch(/Checking current wallet status/);
    expect(buttonTexts().some((t) => t === "Confirm: lock Jane Doe's wallet")).toBe(true);
  });

  it('"Clear" abandons a resolved selection and re-locks the form, rather than relying only on editing the id', async () => {
    stubFetchFull(['wallet.lock'], {
      users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } },
      walletAccounts: { u1: [{ id: 'wa1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 1500 }] },
    });
    await mount();

    setValue(document.getElementById('wl-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();
    expect(document.body.textContent).toMatch(/wallet status/);

    clickButton('Clear');
    await flush();

    expect(document.body.textContent).not.toMatch(/wallet status/);
    expect((document.getElementById('wl-user') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('wl-reason') as HTMLInputElement).disabled).toBe(true);
  });

  it('links back to the resolved customer\'s own profile page (MDF-499, R1)', async () => {
    stubFetchFull(['wallet.lock'], {
      users: { u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } },
      walletAccounts: { u1: [{ id: 'wa1', type: 'USER', status: 'ACTIVE', currency: 'BZD', cachedBalanceMinor: 1500 }] },
    });
    await mount();

    setValue(document.getElementById('wl-user') as HTMLInputElement, 'u1');
    await flush();
    clickButton('Look up');
    await flush();

    const links = Array.from(document.body.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/dashboard/users/u1');
  });
});

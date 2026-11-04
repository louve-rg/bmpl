// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalletOperations } from './WalletOperations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * BMPL-280: WalletOperations (BMPL-270) gates two INDEPENDENT, highly
 * restricted permissions — wallet.credit_test and wallet.reconcile — neither
 * in any standing bundle. A reader holding one must see exactly that one
 * card and not the other.
 *
 * NO "read-only info still renders" assertion here, by design, not oversight:
 * this component has no informational content of its own for a non-holder —
 * it is two write forms and nothing else (its own docstring: "anyone who
 * could view the wallet page also saw both money-creation forms rendered,
 * whether or not they held either restricted permission" was the defect;
 * the fix is that a non-holder now sees NOTHING from this component, which
 * is correct here specifically because neither permission has a report half
 * to preserve — unlike a hub's hours or a route's schedule.
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

interface Account { id: string; firstName: string; lastName: string; email: string }

/** Same as stubFetch, plus the account-lookup and test-credit routes the
 * new confirm-before-credit flow (SHIPPING-E2E-CLOSE) exercises. */
function stubFetchWithAccounts(accounts: Record<string, Account>) {
  const posts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/me')) return jsonResponse(200, { adminPermissions: ['wallet.credit_test'] });
      const lookupMatch = url.match(/\/api\/admin\/users\/([^/?]+)$/);
      if (lookupMatch && (!init?.method || init.method === 'GET')) {
        const account = accounts[decodeURIComponent(lookupMatch[1] ?? '')];
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

describe('WalletOperations — two independent permissions (BMPL-280)', () => {
  it('a reader with neither permission sees nothing at all — no card, no button, zero disabled buttons', async () => {
    stubFetch(['wallet.read']);
    await mount();

    expect(document.body.textContent?.trim()).toBe('');
    expect(buttonTexts().length).toBe(0);
    expect(document.body.querySelectorAll('button[disabled]').length).toBe(0);
  });

  it('wallet.credit_test alone shows the test-credit card but not the stale-hold card', async () => {
    stubFetch(['wallet.credit_test']);
    await mount();

    expect(document.body.textContent).toMatch(/Administrative test credit/);
    expect(document.body.textContent).not.toMatch(/Release stale wallet holds/);
    expect(buttonTexts().some((t) => t.includes('test credit'))).toBe(true);
  });

  it('wallet.reconcile alone shows the stale-hold card but not the test-credit card', async () => {
    stubFetch(['wallet.reconcile']);
    await mount();

    expect(document.body.textContent).toMatch(/Release stale wallet holds/);
    expect(document.body.textContent).not.toMatch(/Administrative test credit/);
    expect(buttonTexts()).toContain('Release stale holds');
  });

  it('holding both shows both cards', async () => {
    stubFetch(['wallet.credit_test', 'wallet.reconcile']);
    await mount();

    expect(document.body.textContent).toMatch(/Administrative test credit/);
    expect(document.body.textContent).toMatch(/Release stale wallet holds/);
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
    stubFetchWithAccounts({ u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } });
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
    const posts = stubFetchWithAccounts({ u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } });
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
    stubFetchWithAccounts({ u1: { id: 'u1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } });
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
    stubFetchWithAccounts({});
    await mount();

    setValue(document.getElementById('tc-user') as HTMLInputElement, 'does-not-exist');
    await flush();
    clickButton('Look up');
    await flush();

    expect(document.body.textContent).toMatch(/User not found\./);
    expect((document.getElementById('tc-amount') as HTMLInputElement).disabled).toBe(true);
  });
});

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

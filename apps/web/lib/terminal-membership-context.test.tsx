// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalMembershipProvider, useSharedTerminalMembership } from './terminal-membership-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stable reference across renders -- see DashboardNavList.test.tsx's own
// comment on why a fresh object literal per call would break this.
const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const apiGet = vi.fn();
vi.mock('./api', () => ({ api: { get: (...args: unknown[]) => apiGet(...args) } }));

function Consumer({ label }: { label: string }) {
  const { status } = useSharedTerminalMembership();
  return <span data-testid={label}>{status}</span>;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  apiGet.mockReset();
  router.push.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

/**
 * TERM-NAV-COST: GET /terminal/me ran once per DashboardNavList instance
 * (Sidebar's desktop copy and MobileNavDrawer's mobile copy, both always
 * mounted) plus once more for TerminalWorkspaceBanner on /dashboard -- up
 * to three independent fetches and three independent retry loops for the
 * same fact about the same user on one page load. One provider, mounted
 * once, makes the real call; everything below it reads the same result.
 */
describe('TerminalMembershipProvider / useSharedTerminalMembership (TERM-NAV-COST)', () => {
  it('fetches /terminal/me exactly once no matter how many consumers read it', async () => {
    apiGet.mockResolvedValue({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'OPERATOR', locations: [] });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <TerminalMembershipProvider>
          <Consumer label="a" />
          <Consumer label="b" />
          <Consumer label="c" />
        </TerminalMembershipProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="a"]')!.textContent).toBe('member');
    expect(container.querySelector('[data-testid="b"]')!.textContent).toBe('member');
    expect(container.querySelector('[data-testid="c"]')!.textContent).toBe('member');
  });

  /**
   * Positive control: proves the single-call result above is the provider
   * actually deduplicating, not a coincidence of the mock -- without one,
   * each consumer is still fully self-sufficient (same as before this
   * card), so two consumers genuinely produce two independent fetches.
   */
  it('without a provider, each consumer fetches independently', async () => {
    apiGet.mockResolvedValue({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'OPERATOR', locations: [] });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <>
          <Consumer label="a" />
          <Consumer label="b" />
        </>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('retry() from one consumer re-checks the shared state that every consumer sees', async () => {
    let calls = 0;
    apiGet.mockImplementation(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('network error'))
        : Promise.resolve({ companyId: 'co_1', companyName: 'Tropic Air', memberRole: 'OPERATOR', locations: [] });
    });

    function RetryingConsumer() {
      const { status, retry } = useSharedTerminalMembership();
      return (
        <div>
          <span data-testid="status">{status}</span>
          <button onClick={retry}>Try again</button>
        </div>
      );
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <TerminalMembershipProvider>
          <RetryingConsumer />
          <Consumer label="other" />
        </TerminalMembershipProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="status"]')!.textContent).toBe('error');
    expect(container.querySelector('[data-testid="other"]')!.textContent).toBe('error');

    const retryButton = container.querySelector('button')!;
    await act(async () => {
      retryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toBe(2);
    expect(container.querySelector('[data-testid="status"]')!.textContent).toBe('member');
    expect(container.querySelector('[data-testid="other"]')!.textContent).toBe('member');
  });
});

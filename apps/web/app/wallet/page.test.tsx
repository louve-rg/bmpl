// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WalletPage from './page';
import type { WalletSummary, WalletTransactionRow, TestFundingStatus } from '../../lib/wallet';

// Same convention as apps/web/app/checkout/page.test.tsx -- react-dom's
// act() checks this flag; no @testing-library/react dependency in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The page renders the public Header, whose mobile list reads matchMedia in
// an effect. jsdom has no matchMedia; test-environment only, same stub as
// checkout/page.test.tsx.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/wallet',
}));

const SUMMARY: WalletSummary = {
  currency: 'BZD',
  availableMinor: 10000,
  onHoldMinor: 0,
  totalMinor: 10000,
  status: 'ACTIVE',
  exists: true,
};
const ROWS: WalletTransactionRow[] = [];
const TEST_FUNDING: TestFundingStatus = { enabled: false };

const walletSummary = vi.fn(() => Promise.resolve(SUMMARY));
const walletTransactions = vi.fn(() => Promise.resolve(ROWS));
const walletTestFundingStatus = vi.fn(() => Promise.resolve(TEST_FUNDING));
const walletTopUp = vi.fn((_amountMinor: number) => Promise.resolve(SUMMARY));
const walletClaimTestFunds = vi.fn(() => Promise.resolve({ transactionId: 't1', creditedMinor: 0, cumulativeMinor: 0, remainingMinor: 0, wallet: SUMMARY }));

vi.mock('../../lib/wallet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/wallet')>()),
  walletApi: {
    summary: () => walletSummary(),
    transactions: () => walletTransactions(),
    testFundingStatus: () => walletTestFundingStatus(),
    topUp: (amountMinor: number) => walletTopUp(amountMinor),
    claimTestFunds: () => walletClaimTestFunds(),
  },
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  walletSummary.mockClear();
  walletTransactions.mockClear();
  walletTestFundingStatus.mockClear();
  walletTopUp.mockClear();
  walletClaimTestFunds.mockClear();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<WalletPage />);
  });
}

function findButton(text: string) {
  return Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement;
}

/**
 * MDF-518: `/wallet/top-up` posts a real ledger TOPUP with no server-side
 * de-duplication across two distinct requests -- the API generates a fresh
 * unique reference per call (confirmed by reading apps/api/src/wallet/wallet.controller.ts),
 * so two same-tick calls do not collide, they both post. `busy` is React
 * state and has not taken effect yet in a second call made in the same tick
 * as the first -- the guard that matters is `addMoneyRef` inside `addMoney`
 * itself (page.tsx). This test proves it by dispatching both clicks inside
 * one `act()`, never awaiting in between.
 */
describe('WalletPage: a same-tick double submit on "Add money" credits the wallet exactly once (MDF-518)', () => {
  it('fires two click events in the same tick and still calls walletApi.topUp exactly once', async () => {
    mount();
    await flush();

    const openTopUp = findButton('Add money');
    expect(openTopUp).toBeTruthy();
    await act(async () => {
      openTopUp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    const submit = findButton('Add money');
    expect(submit).toBeTruthy();

    await act(async () => {
      // Deliberately NOT awaited between dispatches -- both handlers start
      // running before either reaches its first `await`, the exact shape of
      // a same-tick double dispatch (a double-click or double-tap).
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(walletTopUp).toHaveBeenCalledTimes(1);
  });
});

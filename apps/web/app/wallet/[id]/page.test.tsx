// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WalletTransactionDetailPage from './page';
import type { WalletTransactionDetail } from '../../../lib/wallet';
import type { ApiError } from '../../../lib/api';

// Same convention as apps/web/app/wallet/page.test.tsx -- react-dom's act()
// checks this flag; no @testing-library/react dependency in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The page renders the public Header, whose mobile list reads matchMedia in
// an effect. jsdom has no matchMedia -- same stub as wallet/page.test.tsx.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

// A STABLE router object -- see BMPL-380 (driver/jobs/[id]/page.test.tsx):
// a useRouter() mock returning a fresh object every call can break a
// component's own effect dependency chain into an infinite render loop.
const router = { push: vi.fn() };
let paramsId = 'txn1';
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: paramsId }),
  useRouter: () => router,
  usePathname: () => '/wallet/txn1',
}));

const walletTransaction = vi.fn();
vi.mock('../../../lib/wallet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/wallet')>()),
  walletApi: {
    transaction: (id: string) => walletTransaction(id),
  },
}));

function apiError(status: number, message = 'nope'): ApiError {
  return { status, message };
}

const BASE: WalletTransactionDetail = {
  id: 'txn1',
  type: 'ESCROW_HOLD',
  status: 'POSTED',
  currency: 'BZD',
  isTest: false,
  reference: 'ref-123',
  description: null,
  postedAt: '2026-11-20T12:00:00.000Z',
  createdAt: '2026-11-20T12:00:00.000Z',
  balanced: true,
  entries: [
    { direction: 'DEBIT', amountMinor: 2500, accountType: 'CUSTOMER_WALLET', isCustomer: true },
    { direction: 'CREDIT', amountMinor: 2500, accountType: 'ESCROW', isCustomer: false },
  ],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  paramsId = 'txn1';
  walletTransaction.mockClear();
  router.push.mockClear();
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
    root!.render(<WalletTransactionDetailPage />);
  });
}

function text() {
  return container!.textContent ?? '';
}

describe('WalletTransactionDetailPage (MDF-935)', () => {
  it('renders a transaction it is given: type, reference, and every ledger entry', async () => {
    walletTransaction.mockReturnValue(Promise.resolve(BASE));
    mount();
    await flush();

    expect(walletTransaction).toHaveBeenCalledWith('txn1');
    expect(text()).toContain('ESCROW HOLD');
    expect(text()).toContain('ref-123');
    expect(text()).toContain('Your wallet');
    expect(text()).toContain('ESCROW');
  });

  it('shows the signed amount correctly: a credit entry gets a plus sign, a debit entry gets a minus sign', async () => {
    walletTransaction.mockReturnValue(Promise.resolve(BASE));
    mount();
    await flush();

    const items = Array.from(container!.querySelectorAll('li'));
    const debitLine = items.find((li) => li.textContent?.includes('Your wallet'));
    const creditLine = items.find((li) => li.textContent?.includes('ESCROW'));

    expect(debitLine?.textContent).toContain('−BZ$25.00');
    expect(debitLine?.textContent).not.toContain('+');
    expect(creditLine?.textContent).toContain('+BZ$25.00');
  });

  it('a transaction that does not exist (404) does not blank the page or throw -- shows "not found"', async () => {
    walletTransaction.mockReturnValue(Promise.reject(apiError(404)));
    mount();
    await flush();

    expect(text()).toContain('Transaction not found.');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('a server error (non-404) does not blank the page or throw -- shows the error alert', async () => {
    walletTransaction.mockReturnValue(Promise.reject(apiError(500)));
    mount();
    await flush();

    expect(text()).toContain('We could not load this transaction just now');
  });

  it('renders a loading state before the first response resolves', async () => {
    let resolve!: (v: WalletTransactionDetail) => void;
    walletTransaction.mockReturnValue(new Promise((r) => (resolve = r)));
    mount();

    expect(text()).toContain('Loading');

    await act(async () => {
      resolve(BASE);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('a malformed route param does not throw -- the page falls through to the same not-found path as any other bad id', async () => {
    paramsId = '';
    walletTransaction.mockReturnValue(Promise.reject(apiError(404)));

    expect(() => mount()).not.toThrow();
    await flush();

    expect(walletTransaction).toHaveBeenCalledWith('');
    expect(text()).toContain('Transaction not found.');
  });

  // WALLET-DETAIL-TWO-BRANCHES-UNPINNED: BASE above is isTest:false,
  // balanced:true, so every test up to here exercises only the "nothing
  // unusual" side of both `if` branches the page actually renders. Pinned
  // on both sides, not just the true case, so a regression that always
  // shows (or always hides) either one would fail here.
  it('flags simulation money with the badge and the explanatory alert, isTest:true', async () => {
    walletTransaction.mockReturnValue(Promise.resolve({ ...BASE, isTest: true }));
    mount();
    await flush();

    expect(text()).toContain('Simulation');
    expect(text()).toContain('This is simulated money. It has no cash value and was never a real Belize dollar.');
  });

  it('shows neither the simulation badge nor its alert for a real transaction, isTest:false', async () => {
    walletTransaction.mockReturnValue(Promise.resolve({ ...BASE, isTest: false }));
    mount();
    await flush();

    expect(text()).not.toContain('Simulation');
    expect(text()).not.toContain('simulated money');
  });

  it('reports an unbalanced transaction\'s entries, for transparency rather than hiding it', async () => {
    walletTransaction.mockReturnValue(Promise.resolve({ ...BASE, balanced: false }));
    mount();
    await flush();

    expect(text()).toContain("This transaction's entries do not balance");
    expect(text()).toContain('not something you can act on');
  });

  it('says nothing about balance at all for an ordinary, balanced transaction', async () => {
    walletTransaction.mockReturnValue(Promise.resolve({ ...BASE, balanced: true }));
    mount();
    await flush();

    expect(text()).not.toContain('do not balance');
  });
});

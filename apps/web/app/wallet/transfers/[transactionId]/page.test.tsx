// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TransferReceiptPage from './page';
import type { TransferReceipt } from '../../../../lib/wallet';
import type { ApiError } from '../../../../lib/api';

// Same convention as apps/web/app/wallet/[id]/page.test.tsx -- react-dom's
// act() checks this flag; no @testing-library/react dependency in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

// A STABLE router object -- see BMPL-380: a fresh object every call can
// break a component's own effect dependency chain into an infinite loop.
const router = { push: vi.fn() };
let paramsId = 'txn1';
vi.mock('next/navigation', () => ({
  useParams: () => ({ transactionId: paramsId }),
  useRouter: () => router,
  usePathname: () => '/wallet/transfers/txn1',
}));

const walletTransferReceipt = vi.fn();
vi.mock('../../../../lib/wallet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/wallet')>()),
  walletApi: {
    transferReceipt: (id: string) => walletTransferReceipt(id),
  },
}));

function apiError(status: number, message = 'nope'): ApiError {
  return { status, message };
}

const SENT: TransferReceipt = {
  transactionId: 'txn1',
  reference: 'TRF-ABC123',
  direction: 'SENT',
  amountMinor: 2500,
  currency: 'BZD',
  status: 'POSTED',
  counterpartyName: 'Pamela B.',
  note: 'Rent split',
  postedAt: '2026-11-23T12:00:00.000Z',
  isTest: false,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  paramsId = 'txn1';
  walletTransferReceipt.mockClear();
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
    root!.render(<TransferReceiptPage />);
  });
}

function text() {
  return container!.textContent ?? '';
}

/**
 * WALLET-P2P-WEB: privacy-scoped receipt view (reference/amount/counterparty/
 * date/status), reachable from a TRANSFER row in transaction history. A 404
 * covers both "no such transfer" and "not yours" identically -- the API
 * never distinguishes them with a 403, which would itself confirm the
 * transfer exists -- so there is exactly one not-found branch, not two.
 */
describe('TransferReceiptPage', () => {
  it('renders a SENT receipt: amount, counterparty, reference, note, status', async () => {
    walletTransferReceipt.mockReturnValue(Promise.resolve(SENT));
    mount();
    await flush();

    expect(walletTransferReceipt).toHaveBeenCalledWith('txn1');
    expect(text()).toContain('Sent to Pamela B.');
    expect(text()).toContain('BZ$25.00');
    expect(text()).toContain('TRF-ABC123');
    expect(text()).toContain('Rent split');
  });

  it('renders a RECEIVED receipt with the opposite label and a plus sign on the amount', async () => {
    walletTransferReceipt.mockReturnValue(
      Promise.resolve({ ...SENT, direction: 'RECEIVED', counterpartyName: 'Edward B.' }),
    );
    mount();
    await flush();

    expect(text()).toContain('Received from Edward B.');
    const amountEl = Array.from(container!.querySelectorAll('p')).find((p) => p.textContent?.includes('25.00'));
    expect(amountEl?.textContent).toContain('+');
  });

  it('a transfer that does not exist, OR does not belong to the caller, 404s to the SAME "not found" text -- never a 403', async () => {
    walletTransferReceipt.mockReturnValue(Promise.reject(apiError(404)));
    mount();
    await flush();

    expect(text()).toContain('Transfer not found.');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('a server error (non-404) shows the error alert, not a blank page', async () => {
    walletTransferReceipt.mockReturnValue(Promise.reject(apiError(500)));
    mount();
    await flush();

    expect(text()).toContain('We could not load this transfer just now');
  });

  it('flags simulation money with the badge and an explanatory alert', async () => {
    walletTransferReceipt.mockReturnValue(Promise.resolve({ ...SENT, isTest: true }));
    mount();
    await flush();

    expect(text()).toContain('simulated money');
  });

  it('omits the note line entirely when none was given', async () => {
    walletTransferReceipt.mockReturnValue(Promise.resolve({ ...SENT, note: null }));
    mount();
    await flush();

    expect(text()).not.toContain('Note');
  });

  it('redirects to login on a 401 rather than showing "not found"', async () => {
    walletTransferReceipt.mockReturnValue(Promise.reject(apiError(401)));
    mount();
    await flush();

    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('/login'));
    expect(text()).not.toContain('Transfer not found.');
  });
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SendMoneyPage from './page';
import type { RecipientLookup, TransferReceipt, WalletSummary } from '../../../lib/wallet';
import type { ApiError } from '../../../lib/api';

// Same convention as apps/web/app/wallet/page.test.tsx -- react-dom's act()
// checks this flag; no @testing-library/react dependency in this repo.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/wallet/send',
}));

const SUMMARY: WalletSummary = {
  currency: 'BZD',
  availableMinor: 10000,
  onHoldMinor: 0,
  totalMinor: 10000,
  status: 'ACTIVE',
  exists: true,
};

const RECIPIENT: RecipientLookup = { recipientUserId: 'user-2', displayName: 'Pamela B.' };

const RECEIPT: TransferReceipt = {
  transactionId: 'txn1',
  reference: 'TRF-ABC123',
  direction: 'SENT',
  amountMinor: 2500,
  currency: 'BZD',
  status: 'POSTED',
  counterpartyName: 'Pamela B.',
  note: null,
  postedAt: '2026-11-23T12:00:00.000Z',
  isTest: false,
};

function apiError(status: number, message = 'nope'): ApiError {
  return { status, message };
}

const walletSummary = vi.fn(() => Promise.resolve(SUMMARY));
const recipientLookup = vi.fn();
const sendMoney = vi.fn();

vi.mock('../../../lib/wallet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/wallet')>()),
  walletApi: {
    summary: () => walletSummary(),
    recipientLookup: (email: string) => recipientLookup(email),
    sendMoney: (body: unknown) => sendMoney(body),
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
  recipientLookup.mockReset();
  sendMoney.mockReset();
  vi.restoreAllMocks();
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
    root!.render(<SendMoneyPage />);
  });
}

function text() {
  return container!.textContent ?? '';
}

function findButton(matcher: string | RegExp): HTMLButtonElement {
  const btn = Array.from(container!.querySelectorAll('button')).find((b) =>
    typeof matcher === 'string' ? b.textContent === matcher : matcher.test(b.textContent ?? ''),
  );
  if (!btn) throw new Error(`button matching ${matcher} not found in: ${text()}`);
  return btn as HTMLButtonElement;
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
function setInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function setTextareaValue(input: HTMLTextAreaElement, value: string) {
  act(() => {
    nativeTextareaValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function fillEmailAndLookup(email = 'pamela@example.com') {
  const emailInput = container!.querySelector<HTMLInputElement>('#recipient-email')!;
  setInputValue(emailInput, email);
  await act(async () => {
    findButton('Find recipient').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

async function fillAmount(value: string) {
  const amountInput = container!.querySelector<HTMLInputElement>('#transfer-amount')!;
  setInputValue(amountInput, value);
  await flush();
}

/** Mounts, resolves a recipient, and fills a valid in-balance amount -- the
 *  shared setup every test below the recipient step needs. */
async function reachReview(amount = '25.00') {
  recipientLookup.mockResolvedValue(RECIPIENT);
  mount();
  await flush();
  await fillEmailAndLookup();
  await fillAmount(amount);
}

describe('SendMoneyPage recipient step', () => {
  it('shows the resolved displayName and nothing else about the recipient on a successful lookup', async () => {
    recipientLookup.mockResolvedValue(RECIPIENT);
    mount();
    await flush();
    await fillEmailAndLookup('pamela@example.com');

    expect(recipientLookup).toHaveBeenCalledWith('pamela@example.com');
    expect(text()).toContain('Sending to Pamela B.');
  });

  it('shows the server\'s 404 message VERBATIM, never softened, for an unknown/suspended/ineligible email alike', async () => {
    recipientLookup.mockRejectedValue(apiError(404, 'No eligible BML account for that email address.'));
    mount();
    await flush();
    await fillEmailAndLookup('nobody@example.com');

    expect(text()).toContain('No eligible BML account for that email address.');
    expect(text()).not.toContain('Sending to');
  });

  it('editing the email after a successful lookup clears the resolved recipient -- a stale name never rides along with a new address', async () => {
    recipientLookup.mockResolvedValue(RECIPIENT);
    mount();
    await flush();
    await fillEmailAndLookup('pamela@example.com');
    expect(text()).toContain('Sending to Pamela B.');

    const changeBtn = findButton('Change');
    await act(async () => {
      changeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(text()).not.toContain('Sending to Pamela B.');
    // The amount/review sections are gated on a resolved recipient -- they
    // must disappear along with it.
    expect(text()).not.toContain('How much?');
  });

  it('does not show the amount step at all before a recipient is resolved', async () => {
    mount();
    await flush();

    expect(text()).not.toContain('How much?');
  });
});

describe('SendMoneyPage amount step', () => {
  it('shows the AVAILABLE balance, not a raw/different figure', async () => {
    recipientLookup.mockResolvedValue(RECIPIENT);
    mount();
    await flush();
    await fillEmailAndLookup();

    expect(text()).toContain('Available to send: BZ$100.00');
  });

  it('refuses an over-balance amount in the UI, before any server round trip', async () => {
    recipientLookup.mockResolvedValue(RECIPIENT);
    mount();
    await flush();
    await fillEmailAndLookup();
    await fillAmount('500.00'); // balance is BZ$100.00

    expect(text()).toContain('You only have BZ$100.00 available.');
    // The review card -- and its Confirm control -- must not exist at all.
    expect(text()).not.toContain('Review');
  });

  it('does not show the review step for a zero or non-numeric amount', async () => {
    recipientLookup.mockResolvedValue(RECIPIENT);
    mount();
    await flush();
    await fillEmailAndLookup();
    await fillAmount('0');

    expect(text()).not.toContain('Review');
  });
});

describe('SendMoneyPage review step -- the Confirm control does not exist before this', () => {
  it('shows recipient, amount, "No transfer fee", and the total debit', async () => {
    await reachReview('25.00');

    expect(text()).toContain('Review');
    expect(text()).toContain('Pamela B.');
    expect(text()).toContain('No transfer fee');
    expect(text()).toContain('Total debit');
    // Amount and total debit are the SAME figure -- no fee line subtracts
    // from it anywhere.
    expect(text().match(/BZ\$25\.00/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('has no Send/Confirm button anywhere on the page until the review step is reached', async () => {
    recipientLookup.mockResolvedValue(RECIPIENT);
    mount();
    await flush();
    await fillEmailAndLookup();
    // Amount step showing, but no valid amount yet -- review (and Confirm)
    // must not exist.
    expect(() => findButton(/^Send BZ\$/)).toThrow();
  });
});

describe('SendMoneyPage confirm + receipt', () => {
  it('posts recipientUserId, amountMinor, a client-generated idempotencyKey, and the trimmed note', async () => {
    sendMoney.mockResolvedValue(RECEIPT);
    await reachReview('25.00');

    const noteInput = container!.querySelector<HTMLTextAreaElement>('#transfer-note')!;
    setTextareaValue(noteInput, '  Rent split  ');

    await act(async () => {
      findButton(/^Send BZ\$/).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(sendMoney).toHaveBeenCalledTimes(1);
    const body = sendMoney.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.recipientUserId).toBe('user-2');
    expect(body.amountMinor).toBe(2500);
    expect(body.note).toBe('Rent split');
    expect(typeof body.idempotencyKey).toBe('string');
    expect((body.idempotencyKey as string).length).toBeGreaterThan(10);
  });

  it('renders the receipt FROM THE SERVER RESPONSE after a successful send -- reference, counterparty, status, date', async () => {
    sendMoney.mockResolvedValue(RECEIPT);
    await reachReview('25.00');

    await act(async () => {
      findButton(/^Send BZ\$/).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(text()).toContain('Sent');
    expect(text()).toContain('BZ$25.00');
    expect(text()).toContain('Pamela B.');
    expect(text()).toContain('TRF-ABC123');
    // The form itself is gone -- no double-send surface left on screen.
    expect(text()).not.toContain('Review');
  });

  it('a decided server refusal (e.g. insufficient funds) shows the message and returns to the editable review, not a dead end', async () => {
    sendMoney.mockRejectedValue(apiError(400, 'Insufficient available funds.'));
    await reachReview('25.00');

    await act(async () => {
      findButton(/^Send BZ\$/).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(text()).toContain('Insufficient available funds.');
    // Still on the review card, Confirm still reachable -- never shown as a
    // receipt, never a blank/dead page.
    expect(findButton(/^Send BZ\$/)).toBeTruthy();
  });

  it('a same-tick double click on Confirm sends exactly once', async () => {
    sendMoney.mockResolvedValue(RECEIPT);
    await reachReview('25.00');

    const confirmBtn = findButton(/^Send BZ\$/);
    await act(async () => {
      confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(sendMoney).toHaveBeenCalledTimes(1);
  });

  it('a retried submission (after a prior decided refusal) reuses the SAME idempotencyKey -- one key per attempt, not per click', async () => {
    sendMoney.mockRejectedValueOnce(apiError(400, 'Insufficient available funds.'));
    sendMoney.mockResolvedValueOnce(RECEIPT);
    await reachReview('25.00');

    await act(async () => {
      findButton(/^Send BZ\$/).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(text()).toContain('Insufficient available funds.');

    await act(async () => {
      findButton(/^Send BZ\$/).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(sendMoney).toHaveBeenCalledTimes(2);
    const firstKey = (sendMoney.mock.calls[0]![0] as Record<string, unknown>).idempotencyKey;
    const secondKey = (sendMoney.mock.calls[1]![0] as Record<string, unknown>).idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it('a dropped connection (no HTTP status) is NEVER shown as a failure -- it retries with the same key and renders whichever receipt comes back', async () => {
    vi.useFakeTimers();
    try {
      sendMoney.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      sendMoney.mockResolvedValueOnce(RECEIPT);
      await reachReview('25.00');

      await act(async () => {
        findButton(/^Send BZ\$/).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
      // Mid-retry: never worded as an error.
      expect(text()).not.toMatch(/could not send|failed|error/i);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      await flush();

      expect(sendMoney).toHaveBeenCalledTimes(2);
      const firstKey = (sendMoney.mock.calls[0]![0] as Record<string, unknown>).idempotencyKey;
      const secondKey = (sendMoney.mock.calls[1]![0] as Record<string, unknown>).idempotencyKey;
      expect(secondKey).toBe(firstKey);
      expect(text()).toContain('TRF-ABC123');
    } finally {
      vi.useRealTimers();
    }
  });

  it('"Send another" starts a genuinely new attempt -- a SECOND transfer from the same mount uses a DIFFERENT idempotencyKey, not the first transfer\'s', async () => {
    sendMoney.mockResolvedValueOnce(RECEIPT);
    await reachReview('25.00');

    await act(async () => {
      findButton(/^Send BZ\$/).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(text()).toContain('Sent');

    await act(async () => {
      findButton('Send another').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    // Back to the recipient step, with nothing left over from the first attempt.
    expect(text()).not.toContain('Sent');
    expect(text()).not.toContain('Pamela B.');

    recipientLookup.mockResolvedValue({ recipientUserId: 'user-3', displayName: 'Edward B.' });
    sendMoney.mockResolvedValueOnce({ ...RECEIPT, transactionId: 'txn2', reference: 'TRF-XYZ999', counterpartyName: 'Edward B.' });
    await fillEmailAndLookup('edward@example.com');
    await fillAmount('50.00');

    await act(async () => {
      findButton(/^Send BZ\$/).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(sendMoney).toHaveBeenCalledTimes(2);
    const firstKey = (sendMoney.mock.calls[0]![0] as Record<string, unknown>).idempotencyKey;
    const secondKey = (sendMoney.mock.calls[1]![0] as Record<string, unknown>).idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
    expect(text()).toContain('TRF-XYZ999');
  });

  it('exhausting every automatic retry on a dropped connection still never calls it a failure -- offers "Check again" instead', async () => {
    vi.useFakeTimers();
    try {
      sendMoney.mockRejectedValue(new TypeError('Failed to fetch'));
      await reachReview('25.00');

      await act(async () => {
        findButton(/^Send BZ\$/).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });
      await flush();

      expect(text()).not.toMatch(/could not send|failed|error/i);
      expect(text()).toContain('confirming this transfer');
      expect(findButton('Check again')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { Alert, Button, Card, Field, Input, PageHeader, Spinner, StatusBadge, Textarea } from '../../../components/ui';
import { bzd, walletApi, type RecipientLookup, type TransferReceipt, type WalletSummary } from '../../../lib/wallet';
import type { ApiError } from '../../../lib/api';

/**
 * WALLET-P2P-WEB: Send Money.
 *
 * Five steps, the frozen contract's own order: recipient (an exact email,
 * nothing else leaves the server about them) -> amount (against the
 * AVAILABLE balance, never raw) -> review (recipient, amount, "No transfer
 * fee", total debit) -> confirm -> receipt. The review card -- and its
 * Confirm control inside it -- only exists in the DOM once both the earlier
 * steps are genuinely valid; there is no way to reach the control any other
 * way than filling them in first.
 *
 * No fee, no limit beyond the sender's own balance, no pending state, no
 * cancel -- a transfer is atomic and immediately posted. None of that is an
 * oversight; the owner forbade inventing any of it.
 */

const NOTE_MAX = 140;
/**
 * A money amount a person actually typed: digits, an optional single
 * decimal point, up to two decimal places. Nothing else -- `Number(...)`
 * alone happily parses scientific notation ("1e3" -> 1000), hex ("0x10" ->
 * 16), "Infinity" and "NaN" (the latter two already fail the finite check
 * below, but the first two silently do not), so the raw string is checked
 * against this shape BEFORE it is ever handed to `Number()`.
 */
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
/** Automatic retries beyond the first attempt, same key and body each time --
 *  see `postTransferWithRetry` below for why this never shows as a failure. */
const CONFIRM_RETRY_DELAYS_MS = [500, 1500];

function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number';
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export default function SendMoneyPage() {
  /**
   * Generated once per ATTEMPT, not once per mount -- a retry of the SAME
   * attempt (a corrected amount after an insufficient-funds refusal, a
   * dropped connection) reuses it so the server can tell "this is the same
   * thing again" from "this is a new transfer". A rejected attempt never
   * reaches the money-moving step on the server (same precedent as
   * shipping's own idempotency key), so reusing this key after a 400 and
   * changing the amount or recipient is safe -- nothing was reserved
   * against it yet.
   *
   * It must NOT be assumed stable for the life of the mount: "Send another"
   * on the receipt step is a same-route navigation (/wallet/send ->
   * /wallet/send), which the App Router does not remount, so a brand new
   * attempt from THIS mount needs its own explicit reset -- see
   * `startNewAttempt` below. Without it, a second transfer would be sent
   * under the first transfer's key, the server would replay the first
   * receipt, and the UI would show success while the second transfer's
   * money never moved.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [walletError, setWalletError] = useState(false);

  const [email, setEmail] = useState('');
  const [recipient, setRecipient] = useState<RecipientLookup | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  /** No server response at all came back, even after retrying -- never shown
   *  as a failure, since the money may already have moved. */
  const [stillConfirming, setStillConfirming] = useState(false);
  const [receipt, setReceipt] = useState<TransferReceipt | null>(null);
  const confirmInFlight = useRef(false);

  useEffect(() => {
    walletApi.summary().then(setWallet).catch(() => setWalletError(true));
  }, []);

  async function lookupRecipient() {
    const value = email.trim();
    if (!value) return;
    setLookingUp(true);
    setLookupError(null);
    setRecipient(null);
    try {
      setRecipient(await walletApi.recipientLookup(value));
    } catch (e) {
      // The 404 body is the same literal sentence for not-found, suspended
      // and ineligible -- rendered exactly as the server worded it, never
      // softened and never hinting which of the three it actually is.
      setLookupError((e as ApiError).message ?? 'We could not look that up just now.');
    } finally {
      setLookingUp(false);
    }
  }

  function changeEmail(value: string) {
    setEmail(value);
    // A different email invalidates whatever was resolved for the old one --
    // never let a stale displayName ride along with a freshly-edited address.
    setRecipient(null);
    setLookupError(null);
  }

  const availableMinor = wallet?.availableMinor ?? null;
  const amountShapeValid = AMOUNT_PATTERN.test(amount.trim());
  const amountMinor = amountShapeValid ? Math.round(Number(amount.trim()) * 100) : NaN;
  const amountValid = amountShapeValid && Number.isFinite(amountMinor) && amountMinor > 0;
  const overBalance = availableMinor != null && amountValid && amountMinor > availableMinor;
  const canReview = recipient != null && amountValid && !overBalance;

  /**
   * A server-told outcome (has a `status`) is a DECIDED result -- insufficient
   * funds, a self-transfer, an inactive wallet -- and is never retried here;
   * it is shown so the sender can change something and try again. Anything
   * else (a dropped connection, a timeout) has no status at all, and the
   * transfer may already have posted underneath it -- retried with the exact
   * same key and body, which is safe because the endpoint replays rather
   * than duplicates. Running out of automatic attempts is not a failure
   * either; it just stops guessing and lets the caller decide what "not yet
   * confirmed" looks like.
   */
  async function postTransferWithRetry(body: {
    recipientUserId: string;
    amountMinor: number;
    idempotencyKey: string;
    note?: string;
  }): Promise<TransferReceipt> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await walletApi.sendMoney(body);
      } catch (e) {
        if (isApiError(e)) throw e;
        if (attempt >= CONFIRM_RETRY_DELAYS_MS.length) throw e;
        await delay(CONFIRM_RETRY_DELAYS_MS[attempt]!);
      }
    }
  }

  /** Explicit reset for a genuinely new attempt from this same mount -- see
   *  the idempotencyKey comment above for why this cannot be left to happen
   *  as a side effect of navigation. */
  function startNewAttempt() {
    setIdempotencyKey(crypto.randomUUID());
    setEmail('');
    setRecipient(null);
    setLookingUp(false);
    setLookupError(null);
    setAmount('');
    setNote('');
    setConfirming(false);
    setConfirmError(null);
    setStillConfirming(false);
    setReceipt(null);
    confirmInFlight.current = false;
  }

  async function confirm() {
    if (confirmInFlight.current || !recipient || !amountValid) return;
    confirmInFlight.current = true;
    setConfirming(true);
    setConfirmError(null);
    setStillConfirming(false);
    try {
      const r = await postTransferWithRetry({
        recipientUserId: recipient.recipientUserId,
        amountMinor,
        idempotencyKey,
        note: note.trim() || undefined,
      });
      setReceipt(r);
    } catch (e) {
      if (isApiError(e)) {
        setConfirmError(e.message ?? 'We could not send that transfer.');
      } else {
        setStillConfirming(true);
      }
    } finally {
      setConfirming(false);
      confirmInFlight.current = false;
    }
  }

  return (
    <>
      <Header />
      <main className="container-bmpl max-w-xl py-10">
        <Link href="/wallet" className="text-sm text-belize-blue hover:underline">
          ← Wallet
        </Link>

        <div className="mt-4">
          <PageHeader title="Send money" description="Send BML wallet funds to another customer. No transfer fee." />
        </div>

        {walletError && (
          <Alert tone="warning" className="mt-4">
            We could not load your wallet balance just now. Try again in a moment.
          </Alert>
        )}

        {receipt ? (
          <Card className="mt-6 p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Sent</p>
            <p className="mt-1 break-words text-3xl font-bold tabular-nums text-belize-navy">{bzd(receipt.amountMinor)}</p>
            <p className="mt-1 text-sm text-slate-600">to {receipt.counterpartyName}</p>

            <dl className="mt-5 space-y-1.5 border-t border-slate-100 pt-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Reference</dt>
                <dd className="break-all text-right font-mono text-xs text-slate-600">{receipt.reference}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Status</dt>
                <dd>
                  <StatusBadge status={receipt.status} />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Date</dt>
                <dd className="font-medium">
                  {new Date(receipt.postedAt).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' })}
                </dd>
              </div>
              {receipt.note && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Note</dt>
                  <dd className="break-words text-right font-medium">{receipt.note}</dd>
                </div>
              )}
            </dl>

            {receipt.isTest && (
              <Alert tone="info" className="mt-4">
                This is simulated money. It has no cash value.
              </Alert>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/wallet" className="min-h-[44px] inline-flex items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">
                Back to wallet
              </Link>
              <button
                type="button"
                onClick={startNewAttempt}
                className="min-h-[44px] inline-flex items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700"
              >
                Send another
              </button>
            </div>
          </Card>
        ) : stillConfirming ? (
          <Card className="mt-6 p-5 sm:p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-belize-navy">
              <Spinner className="h-4 w-4" /> We are confirming this transfer…
            </div>
            <p className="mt-2 text-sm text-slate-600">
              We lost the connection before we could tell whether this went through. It may already have been sent —
              we are not showing this as a failure because the money may have moved. Tap below to check again; it is
              safe to do more than once.
            </p>
            <div className="mt-4">
              <Button onClick={() => void confirm()} disabled={confirming} className="min-h-[44px]">
                {confirming ? 'Checking…' : 'Check again'}
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {/* 1. Recipient */}
            <Card className="mt-6 p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-belize-navy">Who are you sending to?</h2>
              {recipient ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-bmpl-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-900">Sending to {recipient.displayName}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setRecipient(null);
                      setEmail('');
                    }}
                    className="text-sm font-semibold text-belize-blue hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <Field label="Recipient's email address" htmlFor="recipient-email" error={lookupError}>
                    <Input
                      id="recipient-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => changeEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="mt-1 w-full min-h-[44px]"
                    />
                  </Field>
                  <Button
                    type="button"
                    onClick={() => void lookupRecipient()}
                    disabled={lookingUp || !email.trim()}
                    className="mt-3 min-h-[44px] w-full sm:w-auto"
                  >
                    {lookingUp ? <Spinner className="h-4 w-4" /> : 'Find recipient'}
                  </Button>
                </div>
              )}
            </Card>

            {/* 2. Amount */}
            {recipient && (
              <Card className="mt-4 p-5 sm:p-6">
                <h2 className="text-sm font-semibold text-belize-navy">How much?</h2>
                {availableMinor != null && (
                  <p className="mt-1 text-sm text-slate-600">Available to send: {bzd(availableMinor)}</p>
                )}
                <div className="mt-3">
                  <Field
                    label="Amount (BZ$)"
                    htmlFor="transfer-amount"
                    error={overBalance ? `You only have ${bzd(availableMinor!)} available.` : null}
                  >
                    <Input
                      id="transfer-amount"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="mt-1 w-full min-h-[44px]"
                    />
                  </Field>
                </div>
                <div className="mt-3">
                  <Field label="Note (optional)" htmlFor="transfer-note" hint={`${note.length}/${NOTE_MAX}`}>
                    <Textarea
                      id="transfer-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                      maxLength={NOTE_MAX}
                      rows={2}
                      className="mt-1 w-full"
                    />
                  </Field>
                </div>
              </Card>
            )}

            {/* 3. Review */}
            {canReview && (
              <Card className="mt-4 p-5 sm:p-6">
                <h2 className="text-sm font-semibold text-belize-navy">Review</h2>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">To</dt>
                    <dd className="break-words text-right font-medium">{recipient.displayName}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Amount</dt>
                    <dd className="font-medium tabular-nums">{bzd(amountMinor)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Transfer fee</dt>
                    <dd className="font-medium">No transfer fee</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-slate-100 pt-1.5">
                    <dt className="font-semibold text-belize-navy">Total debit</dt>
                    <dd className="font-bold tabular-nums text-belize-navy">{bzd(amountMinor)}</dd>
                  </div>
                </dl>

                {confirmError && (
                  <Alert tone="warning" className="mt-4">
                    {confirmError}
                  </Alert>
                )}

                <Button onClick={() => void confirm()} disabled={confirming} className="mt-4 min-h-[48px] w-full">
                  {confirming ? 'Sending…' : `Send ${bzd(amountMinor)}`}
                </Button>
              </Card>
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

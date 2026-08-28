'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { bzd, describeTransaction, walletApi, type TestFundingStatus, type WalletSummary, type WalletTransactionRow } from '../../lib/wallet';
import type { ApiError } from '../../lib/api';

/**
 * The customer's wallet.
 *
 * Available is the number that matters, so it is the big one. On hold sits
 * beside it rather than being hidden, because "where did my money go" is the
 * question a hold creates and this page is where it should be answered.
 */

const QUICK_AMOUNTS = [2000, 5000, 10000, 20000];

export default function WalletPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [rows, setRows] = useState<WalletTransactionRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState('50.00');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Whether this account may add simulation funds. Discovered by trying. */
  const [fundingBlocked, setFundingBlocked] = useState<string | null>(null);
  /** TEMPORARY UAT FEATURE. Null until the server has been asked. */
  const [testFunding, setTestFunding] = useState<TestFundingStatus | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([walletApi.summary(), walletApi.transactions()]);
      setSummary(s);
      setRows(t);
      setState('ready');
      // Separately and best-effort: the wallet must still render if this
      // temporary endpoint is gone, which is exactly what happens the moment
      // the feature is switched off.
      walletApi.testFundingStatus().then(setTestFunding).catch(() => setTestFunding({ enabled: false }));
    } catch (e) {
      if ((e as ApiError).status === 401) router.push(`/login?next=${encodeURIComponent('/wallet')}`);
      else setState('error');
    }
  }, [router]);

  /** TEMPORARY UAT FEATURE — see the panel below. */
  async function claimTestFunds() {
    setClaiming(true);
    setErr(null);
    setNote(null);
    try {
      const res = await walletApi.claimTestFunds();
      setNote(`Test credit added — ${bzd(res.creditedMinor)}. These funds are simulated and have no cash value.`);
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'That did not work. Try again in a moment.');
      await load();
    } finally {
      setClaiming(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function addMoney() {
    const minor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minor) || minor <= 0) {
      setErr('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await walletApi.topUp(minor);
      setNote(`${bzd(minor)} added to your wallet.`);
      setTopUpOpen(false);
      await load();
    } catch (e) {
      const api = e as ApiError;
      // A 403 here is not an error the customer caused — it means this account
      // simply cannot add funds, which is worth saying once and keeping visible.
      if (api.status === 403) setFundingBlocked(api.message ?? 'Adding money is not available on this account.');
      else setErr(api.message ?? 'We could not add money just now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <PageHeader title="Wallet" description="Your BML balance, what is committed to orders, and everything that has moved." />

        {state === 'loading' && (
          <div className="mt-8 flex items-center gap-2 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        )}
        {state === 'error' && (
          <Alert tone="warning" className="mt-6">
            We could not load your wallet just now. Try again in a moment.
          </Alert>
        )}
        {note && <Alert tone="success" className="mt-6">{note}</Alert>}
        {err && <Alert tone="warning" className="mt-6">{err}</Alert>}

        {/* TEMPORARY UAT FEATURE — MUST BE DISABLED BEFORE COMMERCIAL LAUNCH.
            Renders only while the server reports the feature switched on, so
            turning the flag off removes it without a web deploy. */}
        {testFunding?.enabled && (
          <Card className="mt-6 border-amber-300 bg-amber-50/60 p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Testing mode</p>
            <h2 className="mt-1 text-lg font-semibold text-belize-navy">Test wallet funding</h2>
            <p className="mt-2 max-w-prose text-sm text-slate-700">
              These wallet funds are simulated and have no cash value. They cannot be
              withdrawn or transferred, and exist so you can try Marketplace and Shipping
              without a card or bank account.
            </p>
            {testFunding.claimed ? (
              <p className="mt-4 text-sm font-medium text-slate-600">
                Your {bzd(testFunding.capMinor ?? 0)} test credit has already been issued.
              </p>
            ) : (
              <div className="mt-4">
                <Button type="button" onClick={() => void claimTestFunds()} disabled={claiming} className="min-h-[48px]">
                  {claiming ? <Spinner className="h-4 w-4" /> : `Add ${bzd(testFunding.amountMinor ?? 0)} test funds`}
                </Button>
                <p className="mt-2 text-xs text-slate-500">
                  One-off, up to {bzd(testFunding.capMinor ?? 0)} per account. Spending does not
                  renew it.
                </p>
              </div>
            )}
          </Card>
        )}

        {summary && (
          <>
            <Card className="mt-6 p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available</p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-belize-navy">{bzd(summary.availableMinor)}</p>

              <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">On hold</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{bzd(summary.onHoldMinor)}</dd>
                  {summary.onHoldMinor > 0 && (
                    <p className="mt-0.5 text-xs text-slate-500">Committed to orders that are still in progress.</p>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Total</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{bzd(summary.totalMinor)}</dd>
                </div>
              </dl>

              {summary.status !== 'ACTIVE' && (
                <Alert tone="warning" className="mt-4">
                  This wallet is {summary.status.toLowerCase()}. Contact support to restore it.
                </Alert>
              )}

              {fundingBlocked ? (
                <Alert tone="info" className="mt-4">
                  {fundingBlocked}
                </Alert>
              ) : (
                <div className="mt-4">
                  {!topUpOpen ? (
                    <Button onClick={() => setTopUpOpen(true)} className="min-h-[44px] w-full sm:w-auto">
                      Add money
                    </Button>
                  ) : (
                    <div className="rounded-bmpl-md border border-slate-200 p-4">
                      <label htmlFor="topup" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Amount (BZ$)
                      </label>
                      <input
                        id="topup"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        inputMode="decimal"
                        className="mt-1 w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {QUICK_AMOUNTS.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => setAmount((a / 100).toFixed(2))}
                            className="min-h-[44px] rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700"
                          >
                            {bzd(a)}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={addMoney} disabled={busy} className="min-h-[44px]">
                          {busy ? 'Adding…' : 'Add money'}
                        </Button>
                        <button
                          type="button"
                          onClick={() => setTopUpOpen(false)}
                          className="min-h-[44px] rounded-bmpl-md border border-slate-300 px-4 text-sm font-semibold text-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            <section className="mt-8">
              <h2 className="text-sm font-semibold text-belize-navy">Transactions</h2>
              {rows.length === 0 ? (
                <div className="mt-3">
                  <EmptyState title="Nothing yet" description="Money you add and orders you pay for will appear here." />
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {rows.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-slate-900">{describeTransaction(t)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {new Date(t.postedAt ?? t.createdAt).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' })}
                          {t.isTest && ' · simulation'}
                        </p>
                      </div>
                      {/* Signed from the customer's point of view: what happened
                          to THEIR balance, not the ledger's symmetry. */}
                      <p
                        className={`shrink-0 text-sm font-semibold tabular-nums ${
                          t.direction === 'IN' ? 'text-emerald-700' : 'text-slate-900'
                        }`}
                      >
                        {t.direction === 'IN' ? '+' : '−'}
                        {bzd(Math.abs(t.signedMinor))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="mt-6 text-sm text-slate-500">
              Looking for a specific order?{' '}
              <Link href="/payments" className="text-belize-blue hover:underline">
                See your payments
              </Link>
              .
            </p>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { Alert, Button, ButtonLink, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';
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
const TRANSACTIONS_PAGE_SIZE = 20;

export default function WalletPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [rows, setRows] = useState<WalletTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState('50.00');
  const [busy, setBusy] = useState(false);
  /**
   * MDF-518: `/wallet/top-up` posts a real ledger TOPUP with no server-side
   * de-duplication across two distinct requests (unlike claimTestFunds below,
   * which is lock+cap-guarded in one transaction) -- the API generates a
   * fresh unique reference per call, so two same-tick calls do not collide,
   * they both post. `busy` is React state and has not taken effect yet in a
   * second call made in the same tick as the first (same reasoning as
   * checkout's placingRef) -- a ref is what actually stops a double-tap of
   * "Add money" from crediting the wallet twice.
   */
  const addMoneyRef = useRef(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Whether this account may add simulation funds. Discovered by trying. */
  const [fundingBlocked, setFundingBlocked] = useState<string | null>(null);
  /** TEMPORARY UAT FEATURE. Null until the server has been asked. */
  const [testFunding, setTestFunding] = useState<TestFundingStatus | null>(null);
  const [claiming, setClaiming] = useState(false);

  /** Server-paginated — a `page` beyond the end just comes back with an empty `rows`, never a client-side slice. */
  const loadTransactions = useCallback(async (p: number) => {
    setRowsLoading(true);
    setRowsError(false);
    try {
      const t = await walletApi.transactions(p, TRANSACTIONS_PAGE_SIZE);
      setRows(t.rows);
      setTotal(t.total);
      setPage(t.page);
    } catch {
      setRowsError(true);
    } finally {
      setRowsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await walletApi.summary();
      setSummary(s);
      setState('ready');
      // Separately and best-effort: the wallet must still render if this
      // temporary endpoint is gone, which is exactly what happens the moment
      // the feature is switched off.
      walletApi.testFundingStatus().then(setTestFunding).catch(() => setTestFunding({ enabled: false }));
    } catch (e) {
      if ((e as ApiError).status === 401) router.push(`/login?next=${encodeURIComponent('/wallet')}`);
      else setState('error');
      return;
    }
    // A mutation (top-up, test credit) always lands its new row at the top of
    // page 1, so a full reload always goes back there rather than staying on
    // whatever page the customer happened to be reading.
    await loadTransactions(1);
  }, [router, loadTransactions]);

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
    if (addMoneyRef.current) return;
    const minor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minor) || minor <= 0) {
      setErr('Enter an amount greater than zero.');
      return;
    }
    addMoneyRef.current = true;
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
      addMoneyRef.current = false;
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
              <p className="mt-1 break-words text-4xl font-bold tabular-nums text-belize-navy">{bzd(summary.availableMinor)}</p>

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
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setTopUpOpen(true)} className="min-h-[44px] w-full sm:w-auto">
                        Add money
                      </Button>
                      {/* WALLET-P2P-WEB: a clearly visible Send Money action,
                          same prominence as Add money rather than tucked
                          into a menu. */}
                      <ButtonLink href="/wallet/send" variant="outline" className="min-h-[44px] w-full sm:w-auto">
                        Send money
                      </ButtonLink>
                    </div>
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
              {rowsLoading && rows.length === 0 ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                  <Spinner className="h-4 w-4" /> Loading…
                </div>
              ) : rowsError ? (
                <Alert tone="warning" className="mt-3">
                  We could not load your transactions just now. Try again in a moment.
                </Alert>
              ) : rows.length === 0 ? (
                <div className="mt-3">
                  <EmptyState title="Nothing yet" description="Money you add and orders you pay for will appear here." />
                </div>
              ) : (
                <>
                  <ul className="mt-3 space-y-2">
                    {rows.map((t) => (
                      <li key={t.id}>
                        <Link
                          // WALLET-P2P-WEB: a TRANSFER row's receipt is privacy-scoped
                          // (reference/amount/counterparty/date/status only) -- the
                          // generic ledger-entries detail page would expose the OTHER
                          // customer's own account internals for a movement between
                          // two people, which `/wallet/[id]` was never built to hide.
                          href={t.type === 'TRANSFER' ? `/wallet/transfers/${t.id}` : `/wallet/${t.id}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm transition hover:border-belize-blue/40 hover:shadow-bmpl-md"
                          data-testid="wallet-transaction-row"
                          data-transaction-type={t.type}
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
                            data-testid="wallet-transaction-amount"
                          >
                            {t.direction === 'IN' ? '+' : '−'}
                            {bzd(Math.abs(t.signedMinor))}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {total > TRANSACTIONS_PAGE_SIZE && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                      <span>
                        Showing {(page - 1) * TRANSACTIONS_PAGE_SIZE + 1}–{Math.min(page * TRANSACTIONS_PAGE_SIZE, total)} of {total}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rowsLoading || page <= 1}
                          onClick={() => void loadTransactions(page - 1)}
                        >
                          Previous
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rowsLoading || page * TRANSACTIONS_PAGE_SIZE >= total}
                          onClick={() => void loadTransactions(page + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
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

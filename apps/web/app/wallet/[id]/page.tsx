'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { Alert, Badge, Card, PageHeader, Spinner, StatusBadge } from '../../../components/ui';
import { bzd, describeTransaction, walletApi, type WalletTransactionDetail } from '../../../lib/wallet';
import type { ApiError } from '../../../lib/api';

/**
 * One wallet transaction, in full — every ledger entry it posted, not just
 * the customer's own signed total the list page shows. Ownership is checked
 * server-side (`WalletService.getForUser`): a transaction with none of your
 * entries 404s there, so there is nothing to re-check here.
 */
export default function WalletTransactionDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [t, setT] = useState<WalletTransactionDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');

  useEffect(() => {
    walletApi
      .transaction(params.id)
      .then((r) => {
        setT(r);
        setState('ready');
      })
      .catch((e) => {
        const err = e as ApiError;
        if (err.status === 401) router.push(`/login?next=${encodeURIComponent(`/wallet/${params.id}`)}`);
        else setState(err.status === 404 ? 'notfound' : 'error');
      });
  }, [params.id, router]);

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <Link href="/wallet" className="text-sm text-belize-blue hover:underline">← Wallet</Link>

        {state === 'loading' && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-14 text-center">
            <Spinner />
            <p className="text-sm text-slate-600">Loading…</p>
          </div>
        )}
        {state === 'notfound' && (
          <div className="mt-8 rounded-bmpl-xl border border-slate-200 bg-white p-10 text-center text-slate-600">
            Transaction not found.
          </div>
        )}
        {state === 'error' && (
          <Alert tone="warning" className="mt-8">
            We could not load this transaction just now. Try again in a moment.
          </Alert>
        )}

        {state === 'ready' && t && (
          <>
            <div className="mt-4">
              <PageHeader
                title={describeTransaction(t)}
                description={new Date(t.postedAt ?? t.createdAt).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' })}
                actions={
                  <div className="flex items-center gap-2">
                    {t.isTest && <Badge tone="info">Simulation</Badge>}
                    <StatusBadge status={t.status} />
                  </div>
                }
              />
            </div>

            {t.isTest && (
              <Alert tone="info" className="mb-4">
                This is simulated money. It has no cash value and was never a real Belize dollar.
              </Alert>
            )}

            <Card className="p-4">
              <h2 className="bmpl-label">Transaction</h2>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Type</dt>
                  <dd className="font-medium text-right">{t.type.replace(/_/g, ' ')}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Currency</dt>
                  <dd className="font-medium">{t.currency}</dd>
                </div>
                {t.reference && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Reference</dt>
                    <dd className="break-all text-right font-mono text-xs text-slate-600">{t.reference}</dd>
                  </div>
                )}
              </dl>
            </Card>

            <Card className="mt-6 overflow-hidden">
              <header className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-belize-navy">
                Ledger entries
              </header>
              {/* Every amount below is exactly what the server posted for this entry —
                  nothing here is summed or re-derived in the browser. */}
              <ul className="divide-y divide-slate-100 text-sm">
                {t.entries.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{e.isCustomer ? 'Your wallet' : e.accountType.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-slate-500">{e.direction === 'CREDIT' ? 'Credit' : 'Debit'}</p>
                    </div>
                    <p
                      className={`shrink-0 font-semibold tabular-nums ${
                        e.direction === 'CREDIT' ? 'text-emerald-700' : 'text-slate-900'
                      }`}
                    >
                      {e.direction === 'CREDIT' ? '+' : '−'}
                      {bzd(e.amountMinor)}
                    </p>
                  </li>
                ))}
              </ul>
              {!t.balanced && (
                <p className="border-t border-slate-100 px-4 py-2 text-xs text-amber-700">
                  This transaction's entries do not balance — reported for transparency, not something you can act on.
                </p>
              )}
            </Card>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

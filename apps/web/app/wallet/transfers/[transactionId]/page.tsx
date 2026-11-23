'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Header } from '../../../../components/landing/Header';
import { Footer } from '../../../../components/landing/Footer';
import { Alert, Card, PageHeader, Spinner, StatusBadge } from '../../../../components/ui';
import { bzd, walletApi, type TransferReceipt } from '../../../../lib/wallet';
import type { ApiError } from '../../../../lib/api';

/**
 * WALLET-P2P-WEB: the privacy-scoped receipt for one transfer -- reference,
 * amount, counterparty, date, status, and nothing from the counterparty's
 * own ledger entries (unlike `/wallet/[id]`'s full ledger-entries view, which
 * would expose the OTHER side's account internals for a movement between two
 * customers). `GET /wallet/transfers/:transactionId` 404s for anyone who is
 * neither the sender nor the recipient -- never a 403, which would itself
 * confirm the transfer exists -- so the "not found" branch below covers both
 * "no such transfer" and "not yours" identically, same as the API intends.
 */
export default function TransferReceiptPage() {
  const router = useRouter();
  const params = useParams<{ transactionId: string }>();
  const [receipt, setReceipt] = useState<TransferReceipt | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');

  useEffect(() => {
    walletApi
      .transferReceipt(params.transactionId)
      .then((r) => {
        setReceipt(r);
        setState('ready');
      })
      .catch((e) => {
        const err = e as ApiError;
        if (err.status === 401) router.push(`/login?next=${encodeURIComponent(`/wallet/transfers/${params.transactionId}`)}`);
        else setState(err.status === 404 ? 'notfound' : 'error');
      });
  }, [params.transactionId, router]);

  return (
    <>
      <Header />
      <main className="container-bmpl max-w-xl py-10">
        <Link href="/wallet" className="text-sm text-belize-blue hover:underline">
          ← Wallet
        </Link>

        {state === 'loading' && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-14 text-center">
            <Spinner />
            <p className="text-sm text-slate-600">Loading…</p>
          </div>
        )}
        {state === 'notfound' && (
          <div className="mt-8 rounded-bmpl-xl border border-slate-200 bg-white p-10 text-center text-slate-600">
            Transfer not found.
          </div>
        )}
        {state === 'error' && (
          <Alert tone="warning" className="mt-8">
            We could not load this transfer just now. Try again in a moment.
          </Alert>
        )}

        {state === 'ready' && receipt && (
          <>
            <div className="mt-4">
              <PageHeader
                title={receipt.direction === 'SENT' ? `Sent to ${receipt.counterpartyName}` : `Received from ${receipt.counterpartyName}`}
                description={new Date(receipt.postedAt).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' })}
                actions={<StatusBadge status={receipt.status} />}
              />
            </div>

            {receipt.isTest && (
              <Alert tone="info" className="mb-4">
                This is simulated money. It has no cash value.
              </Alert>
            )}

            <Card className="p-5 sm:p-6">
              <p className={`text-3xl font-bold tabular-nums ${receipt.direction === 'RECEIVED' ? 'text-emerald-700' : 'text-belize-navy'}`}>
                {receipt.direction === 'RECEIVED' ? '+' : '−'}
                {bzd(receipt.amountMinor)}
              </p>

              <dl className="mt-5 space-y-1.5 border-t border-slate-100 pt-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">{receipt.direction === 'SENT' ? 'To' : 'From'}</dt>
                  <dd className="break-words text-right font-medium">{receipt.counterpartyName}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Reference</dt>
                  <dd className="break-all text-right font-mono text-xs text-slate-600">{receipt.reference}</dd>
                </div>
                {receipt.note && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Note</dt>
                    <dd className="break-words text-right font-medium">{receipt.note}</dd>
                  </div>
                )}
              </dl>
            </Card>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

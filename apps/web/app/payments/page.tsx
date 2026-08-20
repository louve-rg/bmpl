'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { paymentsApi, money, type PaymentCard } from '../../lib/payments';
import { PaymentStatusBadge } from '../../components/payments/PaymentStatusBadge';
import type { ApiError } from '../../lib/api';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';

export default function PaymentsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<PaymentCard[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    paymentsApi
      .listOwn()
      .then((r) => {
        setRows(r);
        setState('ready');
      })
      .catch((e) => {
        if ((e as ApiError).status === 401) router.push(`/login?next=${encodeURIComponent('/payments')}`);
        else setState('error');
      });
  }, [router]);

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <PageHeader
          title="Payments"
          description="Every payment on your account, and what happened to the money."
        />

        {state === 'loading' && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-14 text-center">
            <Spinner />
            <p className="text-sm text-slate-400">Loading…</p>
          </div>
        )}
        {state === 'error' && <Alert tone="error" title="We couldn’t load your payments." className="mt-8" />}

        {state === 'ready' && rows && rows.length === 0 && (
          <div className="mt-8">
            <EmptyState title="No payments yet" description="Payment records appear here once you place an order." />
          </div>
        )}

        {state === 'ready' && rows && rows.length > 0 && (
          <ul className="mt-6 space-y-3">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/payments/${p.id}`} className="block transition hover:-translate-y-0.5">
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-belize-accent hover:shadow-bmpl-md">
                    <div>
                      <p className="font-semibold text-belize-navy">{p.paymentNumber}</p>
                      <p className="text-xs text-slate-500">Order {p.orderNumber} · {new Date(p.createdAt).toLocaleDateString()} · {p.methodType === 'WALLET' ? 'Wallet' : p.methodType}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <PaymentStatusBadge status={p.status} />
                      <span className="font-semibold text-belize-navy">{money(p.amountMinor)}</span>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </>
  );
}

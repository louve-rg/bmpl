'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { paymentsApi, money, type PaymentCard } from '../../lib/payments';
import { PaymentStatusBadge } from '../../components/payments/PaymentStatusBadge';
import type { ApiError } from '../../lib/api';

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
        <h1 className="text-3xl font-bold text-belize-navy">Payments</h1>
        <p className="mt-1 text-sm text-slate-500">Payment processing is coming next — these records are created with your orders.</p>

        {state === 'loading' && <p className="mt-8 text-center text-slate-400">Loading…</p>}
        {state === 'error' && <p className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-700">We couldn’t load your payments.</p>}

        {state === 'ready' && rows && rows.length === 0 && (
          <p className="mt-8 rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-400">No payments yet.</p>
        )}

        {state === 'ready' && rows && rows.length > 0 && (
          <ul className="mt-6 space-y-3">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/payments/${p.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-belize-accent hover:shadow-sm">
                  <div>
                    <p className="font-semibold text-belize-navy">{p.paymentNumber}</p>
                    <p className="text-xs text-slate-500">Order {p.orderNumber} · {new Date(p.createdAt).toLocaleDateString()} · {p.methodType === 'WALLET' ? 'Wallet' : p.methodType}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <PaymentStatusBadge status={p.status} />
                    <span className="font-semibold text-belize-navy">{money(p.amountMinor)}</span>
                  </div>
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

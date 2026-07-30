'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { ordersApi, money, type OrderListItem } from '../../lib/orders';
import { OrderStatusBadge } from '../../components/orders/OrderStatusBadge';
import type { ApiError } from '../../lib/api';

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderListItem[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    ordersApi
      .listOwn()
      .then((o) => {
        setOrders(o);
        setState('ready');
      })
      .catch((e) => {
        if ((e as ApiError).status === 401) router.push(`/login?next=${encodeURIComponent('/orders')}`);
        else setState('error');
      });
  }, [router]);

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <h1 className="text-3xl font-bold text-belize-navy">Your orders</h1>

        {state === 'loading' && <p className="mt-8 text-center text-slate-400">Loading…</p>}
        {state === 'error' && <p className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-700">We couldn’t load your orders.</p>}

        {state === 'ready' && orders && orders.length === 0 && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-12 text-center">
            <p className="text-slate-500">You have no orders yet.</p>
            <Link href="/products" className="mt-4 inline-block rounded-lg bg-belize-blue px-5 py-2.5 text-sm font-semibold text-white">Start shopping</Link>
          </div>
        )}

        {state === 'ready' && orders && orders.length > 0 && (
          <ul className="mt-6 space-y-3">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-belize-accent hover:shadow-sm">
                  <div>
                    <p className="font-semibold text-belize-navy">{o.orderNumber}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(o.placedAt).toLocaleDateString()} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · {o.vendorCount} store{o.vendorCount === 1 ? '' : 's'} · {o.vendors.join(', ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <OrderStatusBadge status={o.status} />
                    <span className="font-semibold text-belize-navy">{money(o.totalMinor)}</span>
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

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { ordersApi, money, type OrderListItem } from '../../lib/orders';
import { OrderStatusBadge } from '../../components/orders/OrderStatusBadge';
import type { ApiError } from '../../lib/api';
import { Alert, ButtonLink, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';

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
        <PageHeader title="Your orders" />

        {state === 'loading' && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-14 text-center">
            <Spinner />
            <p className="text-sm text-slate-400">Loading…</p>
          </div>
        )}
        {state === 'error' && (
          <Alert tone="error" title="We couldn’t load your orders." className="mt-8" />
        )}

        {state === 'ready' && orders && orders.length === 0 && (
          <div className="mt-8">
            <EmptyState
              title="You have no orders yet"
              description="When you place an order, it will show up here."
              action={<ButtonLink href="/products">Start shopping</ButtonLink>}
            />
          </div>
        )}

        {state === 'ready' && orders && orders.length > 0 && (
          <ul className="mt-6 space-y-3">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="block transition hover:-translate-y-0.5">
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-belize-accent hover:shadow-bmpl-md">
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

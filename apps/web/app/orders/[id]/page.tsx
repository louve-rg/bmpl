'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { ordersApi, money, type OrderView } from '../../../lib/orders';
import { OrderStatusBadge, DeliveryBadge } from '../../../components/orders/OrderStatusBadge';
import { paymentsApi, type PaymentDetail } from '../../../lib/payments';
import { PaymentStatusBadge, HoldStatusBadge } from '../../../components/payments/PaymentStatusBadge';
import type { ApiError } from '../../../lib/api';

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const placed = search.get('placed') === '1';
  const [order, setOrder] = useState<OrderView | null>(null);
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');

  useEffect(() => {
    ordersApi
      .getOwn(params.id)
      .then((o) => {
        setOrder(o);
        setState('ready');
        // Payment record is created with the order (M11 foundation) — best-effort.
        paymentsApi.forOrder(params.id).then(setPayment).catch(() => setPayment(null));
      })
      .catch((e) => {
        const err = e as ApiError;
        if (err.status === 401) router.push(`/login?next=${encodeURIComponent(`/orders/${params.id}`)}`);
        else if (err.status === 404) setState('notfound');
        else setState('error');
      });
  }, [params.id, router]);

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <Link href="/orders" className="text-sm text-belize-blue hover:underline">← Your orders</Link>

        {state === 'loading' && <p className="mt-8 text-center text-slate-400">Loading…</p>}
        {state === 'notfound' && <p className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">Order not found.</p>}
        {state === 'error' && <p className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-700">We couldn’t load this order.</p>}

        {state === 'ready' && order && (
          <>
            {placed && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                <p className="font-semibold">Order placed 🎉</p>
                <p className="text-sm">Your order is <strong>pending</strong>. Inventory has been reserved. Payment will be added in a later update.</p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-3xl font-bold text-belize-navy">{order.orderNumber}</h1>
                <p className="text-sm text-slate-500">Placed {new Date(order.placedAt).toLocaleString()}</p>
              </div>
              <OrderStatusBadge status={order.status} />
            </div>

            {order.deliveryAddress && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <p className="text-xs font-semibold uppercase text-slate-500">Delivery address</p>
                <p className="mt-1 text-slate-700">
                  {order.deliveryAddress.fullName}{order.deliveryAddress.phone ? ` · ${order.deliveryAddress.phone}` : ''}<br />
                  {order.deliveryAddress.addressLine1}{order.deliveryAddress.addressLine2 ? `, ${order.deliveryAddress.addressLine2}` : ''}<br />
                  {order.deliveryAddress.city}, {order.deliveryAddress.district.replace('_', ' ')}, {order.deliveryAddress.country}
                </p>
              </div>
            )}

            {/* Payment status placeholder (M11 foundation — no payment button) */}
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase text-slate-500">Payment</p>
                {payment ? <PaymentStatusBadge status={payment.status} /> : <span className="text-xs text-slate-400">—</span>}
              </div>
              {payment && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  <Link href={`/payments/${payment.id}`} className="text-belize-blue hover:underline">{payment.paymentNumber}</Link>
                  <span>{payment.methodType === 'WALLET' ? 'Platform wallet' : payment.methodType}</span>
                  {payment.holds[0] && <HoldStatusBadge status={payment.holds[0].status} />}
                </div>
              )}
              <p className="mt-2 text-xs text-blue-700">Payment processing coming next — no funds have moved.</p>
            </div>

            <div className="mt-6 space-y-4">
              {order.vendorOrders.map((vo) => (
                <section key={vo.id} className="rounded-2xl border border-slate-200 bg-white">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/store/${vo.vendor.slug}`} className="font-semibold text-belize-navy hover:text-belize-blue">{vo.vendor.businessName}</Link>
                      <DeliveryBadge method={vo.deliveryMethod} />
                    </div>
                    <span className="text-xs text-slate-400">{vo.orderNumber}</span>
                  </header>
                  <ul className="divide-y divide-slate-100">
                    {vo.items.map((it, i) => (
                      <li key={i} className="flex items-center gap-3 p-4">
                        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-[10px] text-slate-300">
                          {it.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.imageUrl} alt={it.productTitle} className="h-full w-full object-cover" />
                          ) : 'No image'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-belize-navy">{it.productTitle}</p>
                          {it.variantTitle && <p className="text-xs text-slate-500">{it.variantTitle}</p>}
                          <p className="text-xs text-slate-500">{money(it.unitPriceMinor)} × {it.quantity}</p>
                        </div>
                        <span className="text-sm font-semibold text-belize-navy">{money(it.subtotalMinor)}</span>
                      </li>
                    ))}
                  </ul>
                  {vo.customerNotes && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Notes: {vo.customerNotes}</p>}
                  <div className="flex justify-between border-t border-slate-100 px-4 py-2 text-sm">
                    <span className="text-slate-500">Store subtotal</span>
                    <span className="font-semibold text-belize-navy">{money(vo.subtotalMinor)}</span>
                  </div>
                </section>
              ))}
            </div>

            <div className="mt-6 flex justify-end">
              <div className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-medium">{money(order.subtotalMinor)}</span></div>
                <div className="mt-1 flex justify-between border-t border-slate-100 pt-2 text-base"><span className="font-semibold text-belize-navy">Total</span><span className="font-bold text-belize-navy">{money(order.totalMinor)} {order.currency}</span></div>
                <p className="mt-2 text-xs text-slate-400">Taxes, delivery, and fees not yet applied.</p>
              </div>
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

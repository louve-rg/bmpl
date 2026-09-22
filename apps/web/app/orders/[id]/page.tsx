'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { ordersApi, money, type OrderView } from '../../../lib/orders';
import { paymentExplanation } from '../../../lib/wallet';
import { ORDER_PLACED_MESSAGE } from '../../../lib/order-placed';
import { OrderStatusBadge, DeliveryBadge, DeliveryStatusBadge } from '../../../components/orders/OrderStatusBadge';
import { paymentsApi, type PaymentDetail } from '../../../lib/payments';
import { PaymentStatusBadge, HoldStatusBadge } from '../../../components/payments/PaymentStatusBadge';
import type { ApiError } from '../../../lib/api';
import { Alert, Card, PageHeader, Spinner } from '../../../components/ui';
import { DeliveryTracker } from '../../../components/DeliveryTracker';
import { CustomerPickupCode } from '../../../components/CustomerPickupCode';
import { MessageButton } from '../../../components/messaging/MessageButton';
import { addressLines } from '@bmpl/shared';

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

        {state === 'loading' && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-14 text-center">
            <Spinner />
            <p className="text-sm text-slate-400">Loading…</p>
          </div>
        )}
        {state === 'notfound' && (
          <div className="mt-8 rounded-bmpl-xl border border-slate-200 bg-white p-10 text-center text-slate-400">Order not found.</div>
        )}
        {state === 'error' && <Alert tone="error" title="We couldn’t load this order." className="mt-8" />}

        {state === 'ready' && order && (
          <>
            {placed && (
              // Shown on BOTH payment paths, so it claims neither payment nor
              // order state — the status badge owns that truth (BMPL-155).
              <Alert tone="success" title="Order placed 🎉" className="mt-4">
                {ORDER_PLACED_MESSAGE}
              </Alert>
            )}

            <div className="mt-4">
              <PageHeader
                title={order.orderNumber}
                description={`Placed ${new Date(order.placedAt).toLocaleString()}`}
                actions={<OrderStatusBadge status={order.status} />}
              />
            </div>

            {order.deliveryAddress && (
              <Card className="p-4 text-sm">
                <p className="bmpl-label">Delivery address</p>
                <p className="mt-1 text-slate-700">
                  {order.deliveryAddress.fullName}{order.deliveryAddress.phone ? ` · ${order.deliveryAddress.phone}` : ''}<br />
                  {addressLines(order.deliveryAddress).map((line) => (
                    <Fragment key={line}>
                      {line}
                      <br />
                    </Fragment>
                  ))}
                </p>
              </Card>
            )}

            {/* Payment status placeholder (M11 foundation — no payment button) */}
            <Card className="mt-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="bmpl-label">Payment</p>
                {payment ? <PaymentStatusBadge status={payment.status} /> : <span className="text-xs text-slate-400">—</span>}
              </div>
              {payment && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  <Link href={`/payments/${payment.id}`} className="text-belize-blue hover:underline">{payment.paymentNumber}</Link>
                  <span>{payment.methodType === 'WALLET' ? 'Platform wallet' : payment.methodType}</span>
                  {payment.holds[0] && <HoldStatusBadge status={payment.holds[0].status} />}
                </div>
              )}
              {/* The real state, in the customer's words. This used to say
                  "payment processing coming next — no funds have moved", which
                  stopped being true the moment the wallet went live and would
                  have told somebody their money was untouched while it sat in
                  escrow. */}
              {payment ? (
                <p className="mt-2 text-xs text-slate-600">{paymentExplanation(payment.status, payment.amountMinor)}</p>
              ) : (
                <p className="mt-2 text-xs text-slate-500">No payment record for this order.</p>
              )}
            </Card>

            <div className="mt-6 space-y-4">
              {order.vendorOrders.map((vo) => (
                <Card key={vo.id} className="overflow-hidden">
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
                        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-bmpl-md bg-slate-100 text-[10px] text-slate-300">
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
                  {vo.deliveryMethod === 'DELIVERY' && vo.delivery && (
                    <div className="space-y-1 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
                      <div className="flex flex-wrap items-center gap-2">
                        <DeliveryStatusBadge delivery={vo.delivery} />
                        <span>{vo.delivery.freeApplied ? 'Free delivery' : money(vo.delivery.feeMinor)}</span>
                        {vo.delivery.estimate && (
                          <span>
                            · Est. {vo.delivery.estimate.label ?? `${vo.delivery.estimate.minHours}–${vo.delivery.estimate.maxHours} h`}
                          </span>
                        )}
                      </div>
                      {vo.delivery.instructions && <p className="text-slate-500">Instructions: {vo.delivery.instructions}</p>}
                    </div>
                  )}
                  {vo.deliveryMethod === 'DELIVERY' && vo.delivery?.id && (
                    <DeliveryTracker deliveryId={vo.delivery.id} />
                  )}
                  {vo.deliveryMethod === 'PICKUP' && <CustomerPickupCode vendorOrderId={vo.id} />}
                  {vo.customerNotes && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Notes: {vo.customerNotes}</p>}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2">
                    <MessageButton kind="vendor-order" id={vo.id} />
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500">Store subtotal</span>
                      <span className="font-semibold text-belize-navy">{money(vo.subtotalMinor)}</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="mt-6 flex justify-end">
              <Card className="w-full max-w-xs p-4 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-medium">{money(order.subtotalMinor)}</span></div>
                <div className="mt-1 flex justify-between">
                  <span className="text-slate-500">Delivery</span>
                  <span className="font-medium">
                    {order.vendorOrders.some((vo) => vo.deliveryMethod === 'DELIVERY')
                      ? order.deliveryFeeMinor === 0
                        ? 'Free'
                        : money(order.deliveryFeeMinor)
                      : '—'}
                  </span>
                </div>
                <div className="mt-1 flex justify-between border-t border-slate-100 pt-2 text-base"><span className="font-semibold text-belize-navy">Total</span><span className="font-bold text-belize-navy">{money(order.totalMinor)} {order.currency}</span></div>
              </Card>
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

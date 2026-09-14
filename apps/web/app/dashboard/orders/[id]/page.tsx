'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ordersApi, money, type VendorOrderView } from '../../../../lib/orders';
import { OrderStatusBadge, DeliveryBadge, DeliveryStatusBadge } from '../../../../components/orders/OrderStatusBadge';
import type { ApiError } from '../../../../lib/api';
import { Card, Alert, EmptyState, Spinner } from '../../../../components/ui';
import { VendorDeliveryPanel } from '../../../../components/VendorDeliveryPanel';
import { VendorPickupPanel } from '../../../../components/VendorPickupPanel';
import { VendorFulfilmentPanel } from '../../../../components/VendorFulfilmentPanel';
import { addressLines } from '@bmpl/shared';

export default function VendorOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [vo, setVo] = useState<VendorOrderView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');

  const load = useCallback(() => {
    ordersApi
      .vendorGet(params.id)
      .then((r) => {
        setVo(r);
        setState('ready');
      })
      .catch((e) => setState((e as ApiError).status === 404 ? 'notfound' : 'error'));
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <Link href="/dashboard/orders" className="text-sm text-belize-blue hover:underline">← Store orders</Link>

      {state === 'loading' && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}
      {state === 'notfound' && (
        <div className="mt-6">
          <EmptyState title="Order not found" />
        </div>
      )}
      {state === 'error' && (
        <Alert tone="warning" className="mt-6">
          Failed to load.
        </Alert>
      )}

      {state === 'ready' && vo && (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="bmpl-page-title">{vo.orderNumber}</h1>
              <p className="text-sm text-slate-500">
                Part of order {vo.parentOrderNumber} · placed {vo.placedAt ? new Date(vo.placedAt).toLocaleString() : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <DeliveryBadge method={vo.deliveryMethod} />
              <OrderStatusBadge status={vo.status} />
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card className="p-4 text-sm">
              <p className="bmpl-label">Customer</p>
              <p className="mt-1 text-slate-700">{vo.customerName}</p>
              {vo.customerNotes && <p className="mt-2 text-slate-500">Notes: {vo.customerNotes}</p>}
            </Card>
            {vo.deliveryMethod === 'DELIVERY' && vo.deliveryAddress && (
              <Card className="p-4 text-sm">
                <p className="bmpl-label">Deliver to</p>
                <p className="mt-1 text-slate-700">
                  {vo.deliveryAddress.fullName}{vo.deliveryAddress.phone ? ` · ${vo.deliveryAddress.phone}` : ''}<br />
                  {addressLines(vo.deliveryAddress).map((line) => (
                    <Fragment key={line}>
                      {line}
                      <br />
                    </Fragment>
                  ))}
                </p>
              </Card>
            )}
            {vo.deliveryMethod === 'DELIVERY' && vo.delivery && (
              <Card className="p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="bmpl-label">Delivery</p>
                  <DeliveryStatusBadge delivery={vo.delivery} />
                </div>
                <p className="mt-1 text-slate-700">
                  {vo.delivery.freeApplied ? 'Free delivery' : money(vo.delivery.feeMinor)}
                  {vo.delivery.estimate && (
                    <> · Est. {vo.delivery.estimate.label ?? `${vo.delivery.estimate.minHours}–${vo.delivery.estimate.maxHours} h`}</>
                  )}
                </p>
                {vo.delivery.instructions && <p className="mt-2 text-slate-500">Instructions: {vo.delivery.instructions}</p>}
              </Card>
            )}
          </div>

          {vo.deliveryMethod === 'DELIVERY' && (
            <div className="mt-4 grid gap-4">
              {/* Fulfilment first: this is what the vendor acts on. The delivery
                  panel below it is progress they watch, not something they drive. */}
              <VendorFulfilmentPanel
                vendorOrderId={vo.id}
                status={vo.status as 'PENDING' | 'PREPARING' | 'READY_FOR_PICKUP' | 'PICKED_UP' | 'CANCELLED'}
                onChanged={load}
              />
              {vo.delivery?.id && <VendorDeliveryPanel deliveryId={vo.delivery.id} />}
            </div>
          )}

          {vo.deliveryMethod === 'PICKUP' && (
            <div className="mt-4">
              <VendorPickupPanel
                vendorOrderId={vo.id}
                status={vo.status}
                pickedUpAt={vo.pickedUpAt}
                onChanged={load}
              />
            </div>
          )}

          <div className="mt-4 overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Unit</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {vo.items.map((it, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <span className="font-medium text-belize-navy">{it.productTitle}</span>
                      {it.variantTitle && <span className="text-slate-500"> · {it.variantTitle}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{it.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{money(it.unitPriceMinor)}</td>
                    <td className="px-4 py-3 text-slate-600">{it.quantity}</td>
                    <td className="px-4 py-3 font-semibold text-belize-navy">{money(it.subtotalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end">
            <Card className="flex w-full max-w-xs justify-between p-4 text-sm">
              <span className="font-semibold text-belize-navy">Store subtotal</span>
              <span className="font-bold text-belize-navy">{money(vo.subtotalMinor)} {vo.currency}</span>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

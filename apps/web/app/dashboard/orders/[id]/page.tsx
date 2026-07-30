'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ordersApi, money, type VendorOrderView } from '../../../../lib/orders';
import { OrderStatusBadge, DeliveryBadge } from '../../../../components/orders/OrderStatusBadge';
import type { ApiError } from '../../../../lib/api';

export default function VendorOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [vo, setVo] = useState<VendorOrderView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');

  useEffect(() => {
    ordersApi
      .vendorGet(params.id)
      .then((r) => {
        setVo(r);
        setState('ready');
      })
      .catch((e) => setState((e as ApiError).status === 404 ? 'notfound' : 'error'));
  }, [params.id]);

  return (
    <div>
      <Link href="/dashboard/orders" className="text-sm text-belize-blue hover:underline">← Store orders</Link>

      {state === 'loading' && <p className="mt-6 text-slate-400">Loading…</p>}
      {state === 'notfound' && <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">Order not found.</p>}
      {state === 'error' && <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-700">Failed to load.</p>}

      {state === 'ready' && vo && (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-belize-navy">{vo.orderNumber}</h1>
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
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="text-xs font-semibold uppercase text-slate-500">Customer</p>
              <p className="mt-1 text-slate-700">{vo.customerName}</p>
              {vo.customerNotes && <p className="mt-2 text-slate-500">Notes: {vo.customerNotes}</p>}
            </div>
            {vo.deliveryMethod === 'DELIVERY' && vo.deliveryAddress && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <p className="text-xs font-semibold uppercase text-slate-500">Deliver to</p>
                <p className="mt-1 text-slate-700">
                  {vo.deliveryAddress.fullName}{vo.deliveryAddress.phone ? ` · ${vo.deliveryAddress.phone}` : ''}<br />
                  {vo.deliveryAddress.addressLine1}{vo.deliveryAddress.addressLine2 ? `, ${vo.deliveryAddress.addressLine2}` : ''}<br />
                  {vo.deliveryAddress.city}, {vo.deliveryAddress.district.replace('_', ' ')}
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Unit</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vo.items.map((it, i) => (
                  <tr key={i}>
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
            <div className="flex w-full max-w-xs justify-between rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <span className="font-semibold text-belize-navy">Store subtotal</span>
              <span className="font-bold text-belize-navy">{money(vo.subtotalMinor)} {vo.currency}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

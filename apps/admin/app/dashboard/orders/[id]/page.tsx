'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { Badge, Breadcrumbs, Card, Spinner } from '../../../../components/ui';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { addressLines } from '@bmpl/shared';

interface Item {
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  unitPriceMinor: number;
  quantity: number;
  subtotalMinor: number;
}
interface DeliveryEstimate {
  minHours: number;
  maxHours: number;
  label: string | null;
}
interface Delivery {
  status: string;
  feeMinor: number;
  freeApplied: boolean;
  estimate: DeliveryEstimate | null;
  instructions: string | null;
}
interface VendorOrder {
  id: string;
  orderNumber: string;
  status: string;
  deliveryMethod: 'PICKUP' | 'DELIVERY';
  delivery: Delivery | null;
  customerNotes: string | null;
  itemCount: number;
  subtotalMinor: number;
  vendor: { businessName: string };
  items: Item[];
}
interface AdminOrder {
  id: string;
  orderNumber: string;
  status: string;
  itemCount: number;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  currency: string;
  placedAt: string;
  customer: { name: string; email: string };
  // addressLine1 is nullable: an address may be pinned rather than written.
  deliveryAddress: { fullName: string; phone: string; addressLine1: string | null; addressLine2: string | null; city: string; district: string; country: string } | null;
  vendorOrders: VendorOrder[];
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    api
      .get<AdminOrder>(`/admin/orders/${params.id}`)
      .then((o) => {
        setOrder(o);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [params.id]);

  if (state === 'loading')
    return (
      <div>
        <Breadcrumbs items={adminCrumbs(['Orders', '/dashboard/orders'], 'Order')} className="mb-3" />
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      </div>
    );
  if (state === 'error' || !order)
    return (
      <div>
        <Breadcrumbs items={adminCrumbs(['Orders', '/dashboard/orders'], 'Order')} className="mb-3" />
        <p className="text-sm text-slate-500">Order not found.</p>
      </div>
    );

  return (
    <div>
      <Breadcrumbs items={adminCrumbs(['Orders', '/dashboard/orders'], order.orderNumber)} className="mb-3" />
      <Link href="/dashboard/orders" className="text-sm font-medium text-belize-blue hover:underline">← Orders</Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="bmpl-page-title">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">{order.customer.name} · {order.customer.email} · {new Date(order.placedAt).toLocaleString()}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {order.deliveryAddress && (
        <Card className="mt-4 p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery address</p>
          <p className="mt-1 text-slate-700">
            {order.deliveryAddress.fullName} — {addressLines(order.deliveryAddress).join(', ')}
          </p>
          <p className="mt-1 text-slate-500">{order.deliveryAddress.phone}</p>
        </Card>
      )}

      <div className="mt-5 space-y-4">
        {order.vendorOrders.map((vo) => (
          <Card key={vo.id} className="overflow-hidden p-0">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
              <span className="font-semibold text-belize-navy">{vo.vendor.businessName}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                {vo.orderNumber}
                <Badge tone={vo.deliveryMethod === 'DELIVERY' ? 'info' : 'neutral'}>{vo.deliveryMethod === 'DELIVERY' ? 'Delivery' : 'Pickup'}</Badge>
                <StatusBadge status={vo.status} />
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <tbody>
                  {vo.items.map((it, i) => (
                    <tr key={i} className="border-t border-slate-100 first:border-t-0">
                      <td className="px-4 py-2">{it.productTitle}{it.variantTitle ? ` · ${it.variantTitle}` : ''}</td>
                      <td className="px-4 py-2 text-slate-500">{it.sku ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-600">{money(it.unitPriceMinor)} × {it.quantity}</td>
                      <td className="px-4 py-2 text-right font-semibold text-belize-navy">{money(it.subtotalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {vo.deliveryMethod === 'DELIVERY' && vo.delivery && (
              <div className="space-y-1 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-500">Delivery:</span>
                  <span>{vo.delivery.freeApplied ? 'Free delivery' : money(vo.delivery.feeMinor)}</span>
                  {vo.delivery.estimate && (
                    <span className="text-slate-500">
                      · {vo.delivery.estimate.label ?? `${vo.delivery.estimate.minHours}–${vo.delivery.estimate.maxHours} h`}
                    </span>
                  )}
                  <StatusBadge status={vo.delivery.status} />
                </div>
                {vo.delivery.instructions && <p className="text-slate-500">Instructions: {vo.delivery.instructions}</p>}
              </div>
            )}
            {vo.customerNotes && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Notes: {vo.customerNotes}</p>}
          </Card>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Card className="w-full max-w-xs p-4 text-sm">
          <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>{money(order.subtotalMinor)}</span></div>
          <div className="flex justify-between text-slate-600">
            <span>Delivery</span>
            <span>{order.vendorOrders.some((vo) => vo.deliveryMethod === 'DELIVERY') ? (order.deliveryFeeMinor === 0 ? 'Free' : money(order.deliveryFeeMinor)) : '—'}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-slate-100 pt-2 text-base"><span className="font-semibold text-belize-navy">Total</span><span className="font-bold text-belize-navy">{money(order.totalMinor)} {order.currency}</span></div>
        </Card>
      </div>
    </div>
  );
}

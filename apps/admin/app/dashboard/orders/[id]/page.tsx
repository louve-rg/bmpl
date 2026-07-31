'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { Card, Spinner } from '../../../../components/ui';

interface Item {
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  unitPriceMinor: number;
  quantity: number;
  subtotalMinor: number;
}
interface VendorOrder {
  id: string;
  orderNumber: string;
  status: string;
  deliveryMethod: string;
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
  totalMinor: number;
  currency: string;
  placedAt: string;
  customer: { name: string; email: string };
  deliveryAddress: { fullName: string; addressLine1: string; addressLine2: string | null; city: string; district: string; country: string } | null;
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
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  if (state === 'error' || !order) return <p className="text-sm text-slate-500">Order not found.</p>;

  return (
    <div>
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
            {order.deliveryAddress.fullName} — {order.deliveryAddress.addressLine1}
            {order.deliveryAddress.addressLine2 ? `, ${order.deliveryAddress.addressLine2}` : ''}, {order.deliveryAddress.city}, {order.deliveryAddress.district.replace('_', ' ')}
          </p>
        </Card>
      )}

      <div className="mt-5 space-y-4">
        {order.vendorOrders.map((vo) => (
          <Card key={vo.id} className="overflow-hidden p-0">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
              <span className="font-semibold text-belize-navy">{vo.vendor.businessName}</span>
              <span className="flex items-center gap-1.5 text-xs text-slate-500">{vo.orderNumber} · {vo.deliveryMethod === 'DELIVERY' ? 'Delivery' : 'Pickup'} · <StatusBadge status={vo.status} /></span>
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
            {vo.customerNotes && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Notes: {vo.customerNotes}</p>}
          </Card>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Card className="w-full max-w-xs p-4 text-sm">
          <div className="flex justify-between pt-1 text-base"><span className="font-semibold text-belize-navy">Total</span><span className="font-bold text-belize-navy">{money(order.totalMinor)} {order.currency}</span></div>
        </Card>
      </div>
    </div>
  );
}

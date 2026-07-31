'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ordersApi, money, type VendorOrderListItem } from '../../../lib/orders';
import { OrderStatusBadge, DeliveryBadge } from '../../../components/orders/OrderStatusBadge';
import type { ApiError } from '../../../lib/api';
import { PageHeader, Alert, EmptyState, Spinner, StatusBadge } from '../../../components/ui';

export default function VendorOrdersPage() {
  const [rows, setRows] = useState<VendorOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    ordersApi
      .vendorList()
      .then((r) => setRows(r))
      .catch((e) => setErr((e as ApiError).status === 403 ? 'Create your storefront first.' : 'Failed to load orders.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Store orders" description="Orders placed with your storefront. Fulfilment controls arrive in a later update." />

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}
      {err && (
        <Alert tone="warning" className="mt-6">
          {err}
        </Alert>
      )}
      {!loading && !err && rows.length === 0 && (
        <div className="mt-6">
          <EmptyState title="No orders yet" description="Orders from your storefront will show up here." />
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Fulfilment</th>
                <th className="px-4 py-3">Delivery fee</th>
                <th className="px-4 py-3">Delivery status</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Subtotal</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/orders/${o.id}`} className="font-medium text-belize-blue hover:underline">{o.orderNumber}</Link>
                    <div className="text-xs text-slate-400">{new Date(o.createdAt).toLocaleDateString()}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.customerName}</td>
                  <td className="px-4 py-3"><DeliveryBadge method={o.deliveryMethod} /></td>
                  <td className="px-4 py-3 text-slate-600">{o.deliveryFeeMinor != null ? money(o.deliveryFeeMinor) : '—'}</td>
                  <td className="px-4 py-3">{o.deliveryStatus ? <StatusBadge status={o.deliveryStatus} /> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{o.itemCount}</td>
                  <td className="px-4 py-3 font-semibold text-belize-navy">{money(o.subtotalMinor)}</td>
                  <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

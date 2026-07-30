'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ordersApi, money, type VendorOrderListItem } from '../../../lib/orders';
import { OrderStatusBadge, DeliveryBadge } from '../../../components/orders/OrderStatusBadge';
import type { ApiError } from '../../../lib/api';

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
      <h1 className="text-2xl font-bold text-belize-navy">Store orders</h1>
      <p className="mt-1 text-sm text-slate-500">Orders placed with your storefront. Fulfilment controls arrive in a later update.</p>

      {loading && <p className="mt-6 text-slate-400">Loading…</p>}
      {err && <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-700">{err}</p>}
      {!loading && !err && rows.length === 0 && (
        <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">No orders yet.</p>
      )}

      {rows.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Fulfilment</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Subtotal</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/orders/${o.id}`} className="font-medium text-belize-blue hover:underline">{o.orderNumber}</Link>
                    <div className="text-xs text-slate-400">{new Date(o.createdAt).toLocaleDateString()}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.customerName}</td>
                  <td className="px-4 py-3"><DeliveryBadge method={o.deliveryMethod} /></td>
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

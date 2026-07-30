'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  itemCount: number;
  totalMinor: number;
  currency: string;
  placedAt: string;
  customer: string;
  customerEmail: string;
  vendors: string[];
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Read-only order visibility. No editing / fulfilment controls (M10). */
export default function AdminOrdersPage() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<OrderRow[]>('/admin/orders')
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-belize-navy">Orders</h1>
      <p className="mb-6 text-sm text-slate-500">Read-only view. Fulfilment and payment controls are later milestones.</p>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Stores</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-belize-navy">{o.orderNumber}</p>
                    <p className="text-xs text-slate-500">{new Date(o.placedAt).toLocaleDateString()}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {o.customer}
                    <div className="text-xs text-slate-400">{o.customerEmail}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.vendors.join(', ')}</td>
                  <td className="px-4 py-3 text-slate-600">{o.itemCount}</td>
                  <td className="px-4 py-3 font-semibold text-belize-navy">{money(o.totalMinor)}</td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/orders/${o.id}`} className="font-semibold text-belize-blue hover:underline">View →</Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">No orders yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

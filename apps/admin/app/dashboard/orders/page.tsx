'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { loadErrorMessage } from '../../../lib/load-error';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, EmptyState, PageHeader, Spinner } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

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
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<OrderRow[]>('/admin/orders')
      .then(setRows)
      .catch((e) => setErr(loadErrorMessage(e, 'orders')))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader breadcrumbs={adminCrumbs('Orders')} eyebrow="Fulfilment" title="Orders" description="Read-only view. Fulfilment and payment controls are later milestones." />

      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No orders yet" description="Orders placed across the marketplace will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
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
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

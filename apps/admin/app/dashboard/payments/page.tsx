'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';

interface PaymentRow {
  id: string;
  paymentNumber: string;
  orderNumber: string;
  status: string;
  methodType: string;
  amountMinor: number;
  currency: string;
  customer: string;
  customerEmail: string;
  holds: Array<{ status: string; amountMinor: number }>;
  createdAt: string;
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Read-only payment / wallet-hold / event visibility (M11). No manual actions. */
export default function AdminPaymentsPage() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<PaymentRow[]>('/admin/payments').then(setRows).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-belize-navy">Payments</h1>
      <p className="mb-6 text-sm text-slate-500">Read-only. Foundation only — no funds move yet (wallet holds are reservations).</p>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Hold</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-belize-navy">{p.paymentNumber}</p>
                    <p className="text-xs text-slate-500">Order {p.orderNumber}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.customer}<div className="text-xs text-slate-400">{p.customerEmail}</div></td>
                  <td className="px-4 py-3 text-slate-600">{p.methodType === 'WALLET' ? 'Wallet' : p.methodType}</td>
                  <td className="px-4 py-3 font-semibold text-belize-navy">{money(p.amountMinor)}</td>
                  <td className="px-4 py-3 text-slate-600">{p.holds[0]?.status ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3 text-right"><Link href={`/dashboard/payments/${p.id}`} className="font-semibold text-belize-blue hover:underline">View →</Link></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">No payments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

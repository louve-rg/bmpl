'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { loadErrorMessage } from '../../../lib/load-error';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, PageHeader, Spinner } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

interface ProductRow {
  id: string;
  title: string;
  sku: string;
  status: string;
  priceMinor: number;
  featured: boolean;
  category: string;
  vendor: string;
}

const STATUSES = ['PUBLISHED', 'SUSPENDED', 'ARCHIVED', ''];
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function AdminProductsPage() {
  const [status, setStatus] = useState('PUBLISHED');
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(s: string) {
    setLoading(true);
    setErr(null);
    try {
      setRows(await api.get<ProductRow[]>(`/admin/products${s ? `?status=${s}` : ''}`));
    } catch (e) {
      setErr(loadErrorMessage(e, 'products'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(status);
  }, [status]);

  return (
    <div>
      <PageHeader breadcrumbs={adminCrumbs('Products')} eyebrow="Marketplace" title="Products" />

      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}
      <div className="mb-5 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s || 'ALL'}
            onClick={() => setStatus(s)}
            className={`rounded-bmpl-md px-3 py-1.5 text-xs font-semibold transition ${
              status === s
                ? 'bg-belize-blue text-white'
                : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {s ? s.replace('_', ' ') : 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-belize-navy">{p.title}</p>
                    <p className="text-xs text-slate-500">{p.sku} · {p.category}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{p.vendor}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{money(p.priceMinor)}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/products/${p.id}`} className="font-semibold text-belize-blue hover:underline">
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No products in this state.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

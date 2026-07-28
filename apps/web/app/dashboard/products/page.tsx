'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../lib/api';

interface ProductRow {
  id: string;
  title: string;
  sku: string;
  status: string;
  priceMinor: number;
  category: { name: string };
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  PENDING_REVIEW: 'bg-amber-100 text-amber-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-red-100 text-red-700',
  ARCHIVED: 'bg-slate-100 text-slate-400',
};

export default function VendorProductsPage() {
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<ProductRow[]>('/vendor/products'));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).status === 403 ? 'Create your storefront first, then add products.' : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function act(id: string, action: 'submit' | 'archive' | 'unarchive') {
    try {
      await api.post(`/vendor/products/${id}/${action}`);
      await load();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Action failed.');
    }
  }
  async function del(id: string) {
    if (!window.confirm('Delete this draft product?')) return;
    try {
      await api.del(`/vendor/products/${id}`);
      await load();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Delete failed.');
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-belize-navy">My Products</h1>
        <Link href="/dashboard/products/new" className="rounded-lg bg-belize-blue px-4 py-2 text-sm font-semibold text-white hover:bg-belize-deep">
          + New product
        </Link>
      </div>

      {err && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">{err}</p>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/products/${p.id}`} className="font-medium text-belize-navy hover:text-belize-blue">{p.title}</Link>
                    <p className="text-xs text-slate-500">{p.sku} · {p.category.name}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{money(p.priceMinor)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[p.status] ?? 'bg-slate-100'}`}>
                      {p.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2 text-xs font-semibold">
                      <Link href={`/dashboard/products/${p.id}`} className="text-belize-blue hover:underline">Edit</Link>
                      {(p.status === 'DRAFT' || p.status === 'REJECTED') && (
                        <button onClick={() => act(p.id, 'submit')} className="text-emerald-600 hover:underline">Submit</button>
                      )}
                      {p.status !== 'ARCHIVED' && (
                        <button onClick={() => act(p.id, 'archive')} className="text-slate-500 hover:underline">Archive</button>
                      )}
                      {p.status === 'ARCHIVED' && (
                        <button onClick={() => act(p.id, 'unarchive')} className="text-slate-500 hover:underline">Unarchive</button>
                      )}
                      {p.status === 'DRAFT' && (
                        <button onClick={() => del(p.id)} className="text-red-600 hover:underline">Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">No products yet. Create your first one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

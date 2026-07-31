'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../lib/api';
import { PageHeader, ButtonLink, Alert, Badge, EmptyState, Spinner, type Tone } from '../../../components/ui';

interface ProductRow {
  id: string;
  title: string;
  sku: string;
  status: string;
  priceMinor: number;
  category: { name: string };
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  PUBLISHED: 'success',
  REJECTED: 'error',
  SUSPENDED: 'error',
  ARCHIVED: 'neutral',
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

  async function act(id: string, action: 'archive' | 'unarchive') {
    try {
      await api.post(`/vendor/products/${id}/${action}`);
      await load();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Action failed.');
    }
  }
  async function del(id: string) {
    if (!window.confirm('Delete this product? This cannot be undone.')) return;
    try {
      await api.del(`/vendor/products/${id}`);
      await load();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Delete failed.');
    }
  }

  return (
    <div>
      <PageHeader
        title="My Products"
        actions={
          <ButtonLink href="/dashboard/products/new" size="sm">
            + New product
          </ButtonLink>
        }
      />

      {err && (
        <Alert tone="warning" className="mb-4">
          {err}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Create your first product to start selling on your storefront."
          action={<ButtonLink href="/dashboard/products/new">+ New product</ButtonLink>}
        />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/products/${p.id}`} className="font-medium text-belize-navy hover:text-belize-blue">{p.title}</Link>
                    <p className="text-xs text-slate-500">{p.sku} · {p.category.name}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{money(p.priceMinor)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2 text-xs font-semibold">
                      <Link href={`/dashboard/products/${p.id}`} className="text-belize-blue hover:underline">Edit</Link>
                      {p.status !== 'ARCHIVED' && p.status !== 'SUSPENDED' && (
                        <button onClick={() => act(p.id, 'archive')} className="text-slate-500 hover:underline">Archive</button>
                      )}
                      {p.status === 'ARCHIVED' && (
                        <button onClick={() => act(p.id, 'unarchive')} className="text-slate-500 hover:underline">Unarchive</button>
                      )}
                      {p.status !== 'SUSPENDED' && (
                        <button onClick={() => del(p.id)} className="text-red-600 hover:underline">Delete</button>
                      )}
                    </div>
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

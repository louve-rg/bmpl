'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, type ApiError } from '../../../../lib/api';
import { ProductForm, type ProductValues } from '../ProductForm';

interface OwnProduct {
  id: string;
  title: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  categoryId: string;
  brand: string | null;
  status: string;
  priceMinor: number;
  salePriceMinor: number | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  featured: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  rejectionReason: string | null;
  tags: string[];
}

const dollars = (c: number | null) => (c == null ? '' : (c / 100).toString());
const str = (n: number | null) => (n == null ? '' : String(n));

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const [initial, setInitial] = useState<ProductValues | null>(null);
  const [status, setStatus] = useState('');
  const [rejection, setRejection] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const p = await api.get<OwnProduct>(`/vendor/products/${id}`);
      setStatus(p.status);
      setRejection(p.rejectionReason);
      setInitial({
        id: p.id,
        title: p.title,
        description: p.description ?? '',
        sku: p.sku,
        barcode: p.barcode ?? '',
        categoryId: p.categoryId,
        brand: p.brand ?? '',
        price: dollars(p.priceMinor),
        salePrice: dollars(p.salePriceMinor),
        weightGrams: str(p.weightGrams),
        lengthMm: str(p.lengthMm),
        widthMm: str(p.widthMm),
        heightMm: str(p.heightMm),
        featured: p.featured,
        tags: p.tags.join(', '),
        metaTitle: p.metaTitle ?? '',
        metaDescription: p.metaDescription ?? '',
      });
    } catch (e) {
      setErr((e as ApiError).message ?? 'Not found.');
    }
  }
  useEffect(() => {
    void load();
  }, [id]);

  async function act(action: 'submit' | 'archive') {
    try {
      await api.post(`/vendor/products/${id}/${action}`);
      await load();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Action failed.');
    }
  }

  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!initial) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard/products" className="text-sm text-belize-blue hover:underline">← My Products</Link>
      <div className="mb-6 mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-belize-navy">Edit product</h1>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{status.replace('_', ' ')}</span>
      </div>

      {rejection && status === 'REJECTED' && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Admin feedback: {rejection}
        </p>
      )}

      <div className="mb-5 flex gap-2">
        {(status === 'DRAFT' || status === 'REJECTED') && (
          <button onClick={() => act('submit')} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            Submit for review
          </button>
        )}
        {status !== 'ARCHIVED' && (
          <button onClick={() => act('archive')} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Archive
          </button>
        )}
      </div>

      <ProductForm initial={initial} />
    </div>
  );
}

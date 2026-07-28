'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../../lib/api';

interface CategoryNode {
  id: string;
  name: string;
  children: CategoryNode[];
}

export interface ProductValues {
  id?: string;
  title: string;
  description: string;
  sku: string;
  barcode: string;
  categoryId: string;
  brand: string;
  price: string; // dollars
  salePrice: string; // dollars
  weightGrams: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  featured: boolean;
  tags: string; // comma-separated
  metaTitle: string;
  metaDescription: string;
}

const EMPTY: ProductValues = {
  title: '', description: '', sku: '', barcode: '', categoryId: '', brand: '',
  price: '', salePrice: '', weightGrams: '', lengthMm: '', widthMm: '', heightMm: '',
  featured: false, tags: '', metaTitle: '', metaDescription: '',
};

const input =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30';

function flatten(nodes: CategoryNode[], depth = 0): Array<{ id: string; label: string }> {
  return nodes.flatMap((n) => [
    { id: n.id, label: `${'— '.repeat(depth)}${n.name}` },
    ...flatten(n.children ?? [], depth + 1),
  ]);
}
const toCents = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100));
const toInt = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)));

export function ProductForm({ initial }: { initial?: ProductValues }) {
  const router = useRouter();
  const isEdit = !!initial?.id;
  const [v, setV] = useState<ProductValues>(initial ?? EMPTY);
  const [cats, setCats] = useState<Array<{ id: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api.get<CategoryNode[]>('/marketplace/categories').then((tree) => setCats(flatten(tree))).catch(() => {});
  }, []);

  function set<K extends keyof ProductValues>(k: K, val: ProductValues[K]) {
    setV((prev) => ({ ...prev, [k]: val }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const price = toCents(v.price);
    const body = {
      title: v.title,
      description: v.description || (isEdit ? null : undefined),
      sku: v.sku,
      barcode: v.barcode || (isEdit ? null : undefined),
      categoryId: v.categoryId,
      brand: v.brand || (isEdit ? null : undefined),
      priceMinor: price ?? 0,
      salePriceMinor: toCents(v.salePrice),
      weightGrams: toInt(v.weightGrams),
      lengthMm: toInt(v.lengthMm),
      widthMm: toInt(v.widthMm),
      heightMm: toInt(v.heightMm),
      featured: v.featured,
      tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean),
      metaTitle: v.metaTitle || (isEdit ? null : undefined),
      metaDescription: v.metaDescription || (isEdit ? null : undefined),
    };
    try {
      if (isEdit) {
        await api.patch(`/vendor/products/${initial!.id}`, body);
      } else {
        const created = await api.post<{ id: string }>('/vendor/products', body);
        router.push(`/dashboard/products/${created.id}`);
        return;
      }
      router.push('/dashboard/products');
      router.refresh();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {err && <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}

      <Field label="Title">
        <input className={input} value={v.title} onChange={(e) => set('title', e.target.value)} required />
      </Field>
      <Field label="Description">
        <textarea className={input} rows={4} value={v.description} onChange={(e) => set('description', e.target.value)} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU"><input className={input} value={v.sku} onChange={(e) => set('sku', e.target.value)} required /></Field>
        <Field label="Barcode (optional)"><input className={input} value={v.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
        <Field label="Category">
          <select className={input} value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)} required>
            <option value="">Select a category…</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Brand (optional)"><input className={input} value={v.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
        <Field label="Price (BZD)"><input className={input} inputMode="decimal" value={v.price} onChange={(e) => set('price', e.target.value)} placeholder="0.00" required /></Field>
        <Field label="Sale price (optional)"><input className={input} inputMode="decimal" value={v.salePrice} onChange={(e) => set('salePrice', e.target.value)} placeholder="0.00" /></Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Weight (g)"><input className={input} inputMode="numeric" value={v.weightGrams} onChange={(e) => set('weightGrams', e.target.value)} /></Field>
        <Field label="Length (mm)"><input className={input} inputMode="numeric" value={v.lengthMm} onChange={(e) => set('lengthMm', e.target.value)} /></Field>
        <Field label="Width (mm)"><input className={input} inputMode="numeric" value={v.widthMm} onChange={(e) => set('widthMm', e.target.value)} /></Field>
        <Field label="Height (mm)"><input className={input} inputMode="numeric" value={v.heightMm} onChange={(e) => set('heightMm', e.target.value)} /></Field>
      </div>

      <Field label="Tags (comma-separated)"><input className={input} value={v.tags} onChange={(e) => set('tags', e.target.value)} placeholder="audio, wireless" /></Field>

      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-600">SEO metadata</summary>
        <div className="mt-3 space-y-3">
          <Field label="Meta title"><input className={input} value={v.metaTitle} onChange={(e) => set('metaTitle', e.target.value)} /></Field>
          <Field label="Meta description"><textarea className={input} rows={2} value={v.metaDescription} onChange={(e) => set('metaDescription', e.target.value)} /></Field>
        </div>
      </details>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={v.featured} onChange={(e) => set('featured', e.target.checked)} /> Feature this product
      </label>

      <button disabled={busy} className="rounded-lg bg-belize-blue px-5 py-2.5 text-sm font-semibold text-white hover:bg-belize-deep disabled:opacity-50">
        {isEdit ? 'Save changes' : 'Create product'}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">{label}</span>
      {children}
    </label>
  );
}

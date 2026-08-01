'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type ApiError } from '../../../lib/api';
import { Card, Field, Input, Textarea, Select, Button, Alert } from '../../../components/ui';

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
    <form onSubmit={save} className="space-y-6">
      {err && <Alert tone="error">{err}</Alert>}

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Details</h2>
        <Field label="Title">
          <Input value={v.title} onChange={(e) => set('title', e.target.value)} required />
        </Field>
        <Field label="Description">
          <Textarea rows={4} value={v.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SKU"><Input value={v.sku} onChange={(e) => set('sku', e.target.value)} required /></Field>
          <Field label="Barcode (optional)"><Input value={v.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
          <Field label="Category">
            <Select value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)} required>
              <option value="">Select a category…</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Brand (optional)"><Input value={v.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
          <Field label="Price (BZD)"><Input inputMode="decimal" value={v.price} onChange={(e) => set('price', e.target.value)} placeholder="0.00" required /></Field>
          <Field label="Sale price (optional)"><Input inputMode="decimal" value={v.salePrice} onChange={(e) => set('salePrice', e.target.value)} placeholder="0.00" /></Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Shipping</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Weight (g)"><Input inputMode="numeric" value={v.weightGrams} onChange={(e) => set('weightGrams', e.target.value)} /></Field>
          <Field label="Length (mm)"><Input inputMode="numeric" value={v.lengthMm} onChange={(e) => set('lengthMm', e.target.value)} /></Field>
          <Field label="Width (mm)"><Input inputMode="numeric" value={v.widthMm} onChange={(e) => set('widthMm', e.target.value)} /></Field>
          <Field label="Height (mm)"><Input inputMode="numeric" value={v.heightMm} onChange={(e) => set('heightMm', e.target.value)} /></Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Organization</h2>
        <Field label="Tags (comma-separated)"><Input value={v.tags} onChange={(e) => set('tags', e.target.value)} placeholder="audio, wireless" /></Field>

        <details className="rounded-bmpl-md border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">SEO metadata</summary>
          <div className="mt-3 space-y-3">
            <Field label="Meta title"><Input value={v.metaTitle} onChange={(e) => set('metaTitle', e.target.value)} /></Field>
            <Field label="Meta description"><Textarea rows={2} value={v.metaDescription} onChange={(e) => set('metaDescription', e.target.value)} /></Field>
          </div>
        </details>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
            checked={v.featured}
            onChange={(e) => set('featured', e.target.checked)}
          />
          Feature this product
        </label>
      </Card>

      <div className="space-y-1.5">
        <Button disabled={busy} size="lg">
          {isEdit ? 'Save changes' : 'Next'}
        </Button>
        {!isEdit && (
          <p className="text-xs text-slate-400">You'll add options, variants, images, and inventory next.</p>
        )}
      </div>
    </form>
  );
}

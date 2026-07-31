'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { Card, Alert, Badge } from '../../../components/ui';

interface ProductImage {
  id: string;
  url: string | null;
  altText: string | null;
  caption: string | null;
  position: number;
  isPrimary: boolean;
  variantId: string | null;
}

interface VariantsView {
  options: Array<{ id: string; name: string; values: Array<{ id: string; value: string }> }>;
  variants: Array<{ id: string; sku: string | null; optionValueIds: string[] }>;
}

function readDims(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({});
    img.src = URL.createObjectURL(file);
  });
}

export function ImageManager({ productId }: { productId: string }) {
  const [images, setImages] = useState<ProductImage[]>([]);
  const [variants, setVariants] = useState<Array<{ id: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setImages(await api.get<ProductImage[]>(`/vendor/products/${productId}/images`));
    } catch (e) {
      setErr((e as ApiError).message ?? 'Failed to load images.');
    }
  }
  async function loadVariants() {
    try {
      const v = await api.get<VariantsView>(`/vendor/products/${productId}/variants`);
      const valueMap = new Map<string, string>();
      v.options.forEach((o) => o.values.forEach((val) => valueMap.set(val.id, val.value)));
      setVariants(
        v.variants.map((vr) => ({
          id: vr.id,
          label: vr.optionValueIds.map((id) => valueMap.get(id)).filter(Boolean).join(' / ') || vr.sku || 'Variant',
        })),
      );
    } catch {
      setVariants([]);
    }
  }
  useEffect(() => {
    void load();
    void loadVariants();
  }, [productId]);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const dims = await readDims(file);
      const presign = await api.post<{ uploadUrl: string; key: string }>(
        `/vendor/products/${productId}/images/presign`,
        { fileName: file.name, contentType: file.type, sizeBytes: file.size },
      );
      const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw { message: 'Upload to storage failed (storage may be unconfigured).' };
      setImages(await api.post<ProductImage[]>(`/vendor/products/${productId}/images/confirm`, {
        key: presign.key,
        width: dims.width,
        height: dims.height,
      }));
    } catch (e) {
      setErr((e as ApiError).message ?? 'Upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function call(fn: () => Promise<ProductImage[]>) {
    try {
      setImages(await fn());
    } catch (e) {
      setErr((e as ApiError).message ?? 'Action failed.');
    }
  }

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...images];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    void call(() => api.post(`/vendor/products/${productId}/images/reorder`, { order: next.map((i) => i.id) }));
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="bmpl-eyebrow">Images</h2>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-bmpl-md bg-belize-blue px-3 py-1.5 text-sm font-semibold text-white shadow-bmpl-sm transition hover:bg-belize-deep">
          {busy ? 'Uploading…' : '+ Add image'}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      </div>

      {err && (
        <Alert tone="warning" className="mb-3">
          {err}
        </Alert>
      )}

      {images.length === 0 ? (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-bmpl-lg border-2 border-dashed border-slate-300 px-6 py-8 text-center transition hover:border-belize-accent">
          <span className="text-sm font-medium text-slate-500">No images yet</span>
          <span className="mt-1 text-xs text-slate-400">JPEG, PNG, or WebP up to 8&nbsp;MB.</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      ) : (
        <ul className="space-y-3">
          {images.map((img, idx) => (
            <li key={img.id} className="flex gap-3 rounded-bmpl-md border border-slate-200 p-3">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-bmpl-md bg-slate-100">
                {img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt={img.altText ?? ''} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-[10px] text-slate-400">no preview</span>
                )}
                {img.isPrimary && (
                  <Badge tone="brand" className="absolute left-1 top-1 px-1.5 py-0 text-[10px]">
                    Primary
                  </Badge>
                )}
              </div>
              <div className="flex-1 space-y-1.5">
                <input
                  defaultValue={img.altText ?? ''}
                  placeholder="Alt text"
                  onBlur={(e) => e.target.value !== (img.altText ?? '') && call(() => api.patch(`/vendor/products/${productId}/images/${img.id}`, { altText: e.target.value }))}
                  className="w-full rounded-bmpl-sm border border-slate-200 px-2 py-1 text-xs outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30"
                />
                <input
                  defaultValue={img.caption ?? ''}
                  placeholder="Caption"
                  onBlur={(e) => e.target.value !== (img.caption ?? '') && call(() => api.patch(`/vendor/products/${productId}/images/${img.id}`, { caption: e.target.value }))}
                  className="w-full rounded-bmpl-sm border border-slate-200 px-2 py-1 text-xs outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30"
                />
                {variants.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="shrink-0">Applies to</span>
                    <select
                      value={img.variantId ?? ''}
                      onChange={(e) => call(() => api.patch(`/vendor/products/${productId}/images/${img.id}`, { variantId: e.target.value || null }))}
                      aria-label="Applies to variant"
                      className="w-full rounded-bmpl-sm border border-slate-200 px-2 py-1 text-xs text-belize-navy outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30"
                    >
                      <option value="">All variants (general)</option>
                      {variants.map((v) => (
                        <option key={v.id} value={v.id}>{v.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="flex flex-wrap gap-3 text-xs font-semibold">
                  {!img.isPrimary && (
                    <button onClick={() => call(() => api.post(`/vendor/products/${productId}/images/${img.id}/primary`))} className="text-belize-blue hover:underline">
                      Make primary
                    </button>
                  )}
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move image earlier" className="text-slate-500 hover:underline disabled:opacity-30">↑</button>
                  <button onClick={() => move(idx, 1)} disabled={idx === images.length - 1} aria-label="Move image later" className="text-slate-500 hover:underline disabled:opacity-30">↓</button>
                  <button onClick={() => call(() => api.del(`/vendor/products/${productId}/images/${img.id}`))} className="text-red-600 hover:underline">Delete</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';

interface ProductImage {
  id: string;
  url: string | null;
  altText: string | null;
  caption: string | null;
  position: number;
  isPrimary: boolean;
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
  useEffect(() => {
    void load();
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
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Images</h2>
        <label className="cursor-pointer rounded-lg bg-belize-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-belize-deep">
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

      {err && <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{err}</p>}

      {images.length === 0 ? (
        <p className="text-sm text-slate-400">No images yet. JPEG, PNG, or WebP up to 8&nbsp;MB.</p>
      ) : (
        <ul className="space-y-3">
          {images.map((img, idx) => (
            <li key={img.id} className="flex gap-3 rounded-lg border border-slate-200 p-2">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded bg-slate-100">
                {img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt={img.altText ?? ''} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-[10px] text-slate-400">no preview</span>
                )}
                {img.isPrimary && (
                  <span className="absolute left-0 top-0 bg-belize-blue px-1 text-[10px] font-bold text-white">PRIMARY</span>
                )}
              </div>
              <div className="flex-1 space-y-1">
                <input
                  defaultValue={img.altText ?? ''}
                  placeholder="Alt text"
                  onBlur={(e) => e.target.value !== (img.altText ?? '') && call(() => api.patch(`/vendor/products/${productId}/images/${img.id}`, { altText: e.target.value }))}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                />
                <input
                  defaultValue={img.caption ?? ''}
                  placeholder="Caption"
                  onBlur={(e) => e.target.value !== (img.caption ?? '') && call(() => api.patch(`/vendor/products/${productId}/images/${img.id}`, { caption: e.target.value }))}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
                />
                <div className="flex gap-2 text-xs font-semibold">
                  {!img.isPrimary && (
                    <button onClick={() => call(() => api.post(`/vendor/products/${productId}/images/${img.id}/primary`))} className="text-belize-blue hover:underline">
                      Make primary
                    </button>
                  )}
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-slate-500 hover:underline disabled:opacity-30">↑</button>
                  <button onClick={() => move(idx, 1)} disabled={idx === images.length - 1} className="text-slate-500 hover:underline disabled:opacity-30">↓</button>
                  <button onClick={() => call(() => api.del(`/vendor/products/${productId}/images/${img.id}`))} className="text-red-600 hover:underline">Delete</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

'use client';

import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Badge } from '../ui';
import type { ProductImage } from './types';
import { asApiError, tinyInput } from './shared';
import { presignAndPut } from './uploads';

const ACCEPT = 'image/jpeg,image/png,image/webp';

export interface VariantChoice {
  id: string;
  label: string;
}

interface Props {
  productId: string;
  variantId: string | null;
  images: ProductImage[]; // this group only, sorted by position
  variantChoices: VariantChoice[];
  move: (imageId: string, dir: -1 | 1) => void | Promise<void>;
  onMutate: () => Promise<void>;
  onError: (msg: string) => void;
}

export function ImageGallery({ productId, variantId, images, variantChoices, move, onMutate, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadMany(files: FileList) {
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const up = await presignAndPut(productId, file);
        await api.post(`/vendor/products/${productId}/images/confirm`, {
          key: up.key,
          variantId: variantId ?? undefined,
          width: up.width,
          height: up.height,
        });
      }
      await onMutate();
    } catch (e) {
      onError(asApiError(e).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      {images.length === 0 ? (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-bmpl-md border-2 border-dashed border-slate-300 px-4 py-6 text-center transition hover:border-belize-accent">
          <span className="text-sm font-medium text-slate-500">{busy ? 'Uploading…' : 'Add images'}</span>
          <span className="mt-0.5 text-xs text-slate-400">JPEG, PNG or WebP. Tap an image later to replace it.</span>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => e.target.files?.length && uploadMany(e.target.files)}
          />
        </label>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {images.map((img, idx) => (
              <ImageCard
                key={img.id}
                productId={productId}
                img={img}
                variantChoices={variantChoices}
                isFirst={idx === 0}
                isLast={idx === images.length - 1}
                move={move}
                onMutate={onMutate}
                onError={onError}
              />
            ))}
          </ul>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-bmpl-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-belize-navy transition hover:border-belize-blue hover:bg-belize-blue/5">
            {busy ? 'Uploading…' : '+ Add more images'}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => e.target.files?.length && uploadMany(e.target.files)}
            />
          </label>
        </>
      )}
    </div>
  );
}

function ImageCard({
  productId,
  img,
  variantChoices,
  isFirst,
  isLast,
  move,
  onMutate,
  onError,
}: {
  productId: string;
  img: ProductImage;
  variantChoices: VariantChoice[];
  isFirst: boolean;
  isLast: boolean;
  move: (imageId: string, dir: -1 | 1) => void | Promise<void>;
  onMutate: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [replacing, setReplacing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);

  async function replace(file: File) {
    setReplacing(true);
    try {
      const up = await presignAndPut(productId, file);
      await api.post(`/vendor/products/${productId}/images/${img.id}/replace`, {
        key: up.key,
        width: up.width,
        height: up.height,
      });
      await onMutate();
    } catch (e) {
      onError(asApiError(e).message);
    } finally {
      setReplacing(false);
      if (replaceRef.current) replaceRef.current.value = '';
    }
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await onMutate();
    } catch (e) {
      onError(asApiError(e).message);
    }
  }

  return (
    <li className="flex gap-3 rounded-bmpl-md border border-slate-200 p-2.5">
      <div className="relative h-20 w-20 shrink-0">
        <button
          type="button"
          onClick={() => replaceRef.current?.click()}
          className="group relative block h-full w-full overflow-hidden rounded-bmpl-md bg-slate-100"
          title="Tap to replace this image"
          aria-label="Replace image"
        >
          {img.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img.url} alt={img.altText ?? ''} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-[10px] text-slate-400">no preview</span>
          )}
          <span className="absolute inset-0 hidden items-center justify-center bg-belize-navy/55 text-[10px] font-semibold text-white group-hover:flex">
            {replacing ? 'Replacing…' : 'Replace'}
          </span>
        </button>
        {img.isPrimary && (
          <Badge tone="brand" className="absolute left-1 top-1 px-1.5 py-0 text-[10px]">
            Primary
          </Badge>
        )}
        <input
          ref={replaceRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && replace(e.target.files[0])}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <input
          defaultValue={img.altText ?? ''}
          placeholder="Alt text (for accessibility & SEO)"
          onBlur={(e) => e.target.value !== (img.altText ?? '') && void act(() => api.patch(`/vendor/products/${productId}/images/${img.id}`, { altText: e.target.value }))}
          className={`${tinyInput} w-full`}
          aria-label="Alt text"
        />
        {variantChoices.length > 0 && (
          <select
            value={img.variantId ?? ''}
            onChange={(e) => void act(() => api.patch(`/vendor/products/${productId}/images/${img.id}`, { variantId: e.target.value || null }))}
            aria-label="Move image to variant"
            className={`${tinyInput} w-full`}
          >
            <option value="">General (all variants)</option>
            {variantChoices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
          {!img.isPrimary && (
            <button type="button" onClick={() => void act(() => api.post(`/vendor/products/${productId}/images/${img.id}/primary`))} className="text-belize-blue hover:underline">
              Make primary
            </button>
          )}
          <button type="button" onClick={() => void move(img.id, -1)} disabled={isFirst} aria-label="Move earlier" className="text-slate-500 hover:underline disabled:opacity-30">
            ↑
          </button>
          <button type="button" onClick={() => void move(img.id, 1)} disabled={isLast} aria-label="Move later" className="text-slate-500 hover:underline disabled:opacity-30">
            ↓
          </button>
          {confirmDel ? (
            <span className="inline-flex items-center gap-2">
              <button type="button" onClick={() => void act(() => api.del(`/vendor/products/${productId}/images/${img.id}`))} className="rounded-bmpl-sm bg-red-600 px-2 py-0.5 text-white hover:bg-red-700">
                Confirm remove
              </button>
              <button type="button" onClick={() => setConfirmDel(false)} className="text-slate-500 hover:underline">
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDel(true)} className="text-red-600 hover:underline">
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

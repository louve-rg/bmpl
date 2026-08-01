'use client';

import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Badge } from '../ui';
import type { ProductImage } from './types';
import { asApiError, ConfirmAction } from './shared';
import { presignAndPut } from './uploads';

const ACCEPT = 'image/jpeg,image/png,image/webp';

const HELPER = 'Shown on marketplace listing cards. Not shown in the product detail gallery.';

interface Props {
  productId: string;
  image: ProductImage | null;
  onMutate: () => Promise<void>;
  onError: (msg: string) => void;
}

/**
 * The single Brand Image slot (Phase M6.2). Sits above the general gallery and
 * per-variant galleries. At most one brand image is active; it is set from any
 * other image via "Set as Brand Image" (POST …/brand), and removed here (DELETE
 * …/brand) which returns it to the general gallery.
 */
export function BrandImageSlot({ productId, image, onMutate, onError }: Props) {
  const [replacing, setReplacing] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);

  async function replace(file: File) {
    setReplacing(true);
    try {
      const up = await presignAndPut(productId, file);
      await api.post(`/vendor/products/${productId}/images/${image!.id}/replace`, {
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

  async function removeBrand() {
    try {
      await api.del(`/vendor/products/${productId}/images/${image!.id}/brand`);
      await onMutate();
    } catch (e) {
      onError(asApiError(e).message);
    }
  }

  if (!image) {
    return (
      <div className="rounded-bmpl-md border-2 border-dashed border-slate-300 px-4 py-5 text-center">
        <p className="text-sm font-medium text-slate-500">No brand image set</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
          {HELPER} Use “Set as Brand Image” on any image below to choose one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-bmpl-md border border-slate-200 p-3 sm:flex-row sm:items-start">
      <div className="relative h-28 w-28 shrink-0 self-center sm:self-start">
        <button
          type="button"
          onClick={() => replaceRef.current?.click()}
          className="group relative block h-full w-full overflow-hidden rounded-bmpl-md bg-slate-100"
          title="Tap to replace the brand image"
          aria-label="Replace brand image"
        >
          {image.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.url} alt={image.altText ?? ''} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-[10px] text-slate-400">no preview</span>
          )}
          <span className="absolute inset-0 hidden items-center justify-center bg-belize-navy/55 text-[11px] font-semibold text-white group-hover:flex">
            {replacing ? 'Replacing…' : 'Replace'}
          </span>
        </button>
        <input
          ref={replaceRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && replace(e.target.files[0])}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <Badge tone="brand">Brand Image</Badge>
        <p className="text-xs text-slate-500">{HELPER}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => replaceRef.current?.click()}
            className="min-h-[32px] text-belize-blue hover:underline"
          >
            {replacing ? 'Replacing…' : 'Replace'}
          </button>
          <ConfirmAction
            label="Remove brand image"
            confirmLabel="Confirm remove"
            onConfirm={removeBrand}
          />
        </div>
      </div>
    </div>
  );
}

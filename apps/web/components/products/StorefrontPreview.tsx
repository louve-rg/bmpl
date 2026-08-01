'use client';

import { useState } from 'react';
import type { ProductImage } from './types';

/** A light approximation of how the storefront gallery will render the images. */
export function StorefrontPreview({ productTitle, images }: { productTitle: string; images: ProductImage[] }) {
  const ordered = [...images].sort((a, b) => a.position - b.position);
  const withUrl = ordered.filter((i) => i.url);
  const [active, setActive] = useState(0);

  if (withUrl.length === 0) {
    return <p className="text-sm text-slate-400">Add images to preview the storefront gallery.</p>;
  }
  const hero = withUrl[Math.min(active, withUrl.length - 1)]!;

  return (
    <div>
      <div className="aspect-square w-full max-w-xs overflow-hidden rounded-bmpl-lg bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={hero.url ?? ''} alt={hero.altText ?? productTitle} className="h-full w-full object-cover" />
      </div>
      {withUrl.length > 1 && (
        <div className="mt-2 flex max-w-xs gap-2 overflow-x-auto pb-1">
          {withUrl.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              className={`h-12 w-12 shrink-0 overflow-hidden rounded-bmpl-md border-2 ${i === Math.min(active, withUrl.length - 1) ? 'border-belize-accent' : 'border-transparent'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url ?? ''} alt={img.altText ?? ''} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        {withUrl.length} image{withUrl.length === 1 ? '' : 's'} · buyers see the primary image first within each selection.
      </p>
    </div>
  );
}

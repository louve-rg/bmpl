'use client';

import { useState } from 'react';

export interface GalleryImage {
  id: string;
  url: string | null;
  altText: string | null;
  variantId?: string | null;
}

export function Gallery({ images }: { images: GalleryImage[] }) {
  const usable = images.filter((i) => i.url);
  const [active, setActive] = useState(0);

  if (usable.length === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-bmpl-lg border border-slate-200 bg-slate-100 text-sm text-slate-400">
        No image yet
      </div>
    );
  }

  const current = usable[Math.min(active, usable.length - 1)]!;
  return (
    <div>
      <div className="aspect-square overflow-hidden rounded-bmpl-lg border border-slate-200 bg-slate-100 shadow-bmpl-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.url!} alt={current.altText ?? ''} className="h-full w-full object-cover" />
      </div>
      {usable.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {usable.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1}`}
              aria-current={i === active}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-bmpl-sm border-2 transition ${i === active ? 'border-belize-blue' : 'border-transparent hover:border-slate-300'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url!} alt={img.altText ?? ''} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

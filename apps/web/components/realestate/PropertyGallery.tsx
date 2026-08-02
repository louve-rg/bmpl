'use client';

import { useState } from 'react';
import type { PropertyImage } from '../../lib/realestate';

/** Image gallery with a large active image and a thumbnail strip. Public detail view. */
export function PropertyGallery({ images, title }: { images: PropertyImage[]; title: string }) {
  const usable = images.filter((i) => i.url);
  const [active, setActive] = useState(0);

  if (usable.length === 0) {
    return (
      <div className="flex aspect-[16/9] w-full items-center justify-center rounded-bmpl-lg border border-slate-200 bg-slate-100 text-slate-300">
        <svg viewBox="0 0 24 24" className="h-16 w-16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
          <path d="M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5M9 20v-6h6v6" />
        </svg>
      </div>
    );
  }

  const current = usable[Math.min(active, usable.length - 1)];
  if (!current) return null;

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-bmpl-lg border border-slate-200 bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url ?? ''}
          alt={current.altText ?? title}
          className="aspect-[16/9] w-full object-cover"
        />
        {current.caption && (
          <p className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-4 py-2 text-sm text-white">
            {current.caption}
          </p>
        )}
      </div>
      {usable.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {usable.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1}`}
              aria-current={i === active}
              className={`h-16 w-24 shrink-0 overflow-hidden rounded-bmpl-md border-2 transition ${
                i === active ? 'border-belize-blue' : 'border-transparent opacity-80 hover:opacity-100'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url ?? ''} alt={img.altText ?? ''} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

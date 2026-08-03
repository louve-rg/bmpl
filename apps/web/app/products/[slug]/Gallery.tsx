'use client';

import { useRef, useState } from 'react';
import { swipeDirection, clampIndex, indexAfterSwipe } from '../../../lib/gallery-nav';

export interface GalleryImage {
  id: string;
  url: string | null;
  altText: string | null;
  variantId?: string | null;
  position?: number;
  isPrimary?: boolean;
  isBrandImage?: boolean;
  role?: 'BRAND' | 'GENERAL' | 'VARIANT';
}

// A horizontal drag past this many px counts as a swipe.
const SWIPE_THRESHOLD = 40;

/**
 * Product image gallery. The main image is shown in full (object-contain, never
 * cropped) on a neutral backdrop; thumbnails, arrow buttons, keyboard (←/→), and
 * touch-swipe (iOS Safari / Android Chrome) all drive the SAME `active` index, so
 * everything stays synchronized. Variant switches reset to the variant's primary
 * image because the parent remounts this component via `key` — do not remove that.
 */
export function Gallery({ images }: { images: GalleryImage[] }) {
  const usable = images.filter((i) => i.url);
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);

  if (usable.length === 0) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-bmpl-lg border border-slate-200 bg-slate-100 text-sm text-slate-400">
        No image yet
      </div>
    );
  }

  const index = Math.min(active, usable.length - 1);
  const current = usable[index]!;
  const many = usable.length > 1;
  const go = (n: number) => setActive(() => clampIndex(n, usable.length));

  return (
    <div>
      <div
        className="group relative aspect-square select-none overflow-hidden rounded-bmpl-lg border border-slate-200 bg-slate-100 shadow-bmpl-sm"
        role="group"
        aria-roledescription="carousel"
        aria-label="Product images"
        tabIndex={many ? 0 : -1}
        onKeyDown={(e) => {
          if (!many) return;
          if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
        }}
        onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          if (!many) return;
          const dir = swipeDirection(touchStartX.current, e.changedTouches[0]?.clientX ?? touchStartX.current ?? 0, SWIPE_THRESHOLD);
          if (dir) setActive(indexAfterSwipe(index, dir, usable.length));
          touchStartX.current = null;
        }}
      >
        {/* Full product image — object-contain so tall AND wide photos are never cropped. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.url!} alt={current.altText ?? ''} className="h-full w-full object-contain" draggable={false} />

        {many && (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-belize-navy shadow-bmpl-sm backdrop-blur transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-belize-accent disabled:opacity-0"
            >
              <span aria-hidden>‹</span>
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => go(index + 1)}
              disabled={index === usable.length - 1}
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-belize-navy shadow-bmpl-sm backdrop-blur transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-belize-accent disabled:opacity-0"
            >
              <span aria-hidden>›</span>
            </button>
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2 py-0.5 text-xs font-medium text-white" aria-hidden>
              {index + 1} / {usable.length}
            </div>
          </>
        )}
      </div>

      {many && (
        <div className="mt-3 flex gap-2 overflow-x-auto" role="tablist" aria-label="Product image thumbnails">
          {usable.map((img, i) => (
            <button
              key={img.id}
              type="button"
              role="tab"
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1}`}
              aria-selected={i === index}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-bmpl-sm border-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-belize-accent ${i === index ? 'border-belize-blue' : 'border-transparent hover:border-slate-300'}`}
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

'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A thumbnail that opens its image in a full-screen lightbox. The trigger keeps
 * the layout's (possibly cropped) framing; the lightbox shows the full image at
 * quality via object-contain. Closes on the ✕ button, backdrop click, or ESC.
 */
export function EnlargeableImage({
  src,
  alt,
  label = 'Enlarge image',
  triggerClassName = '',
  imgClassName = '',
}: {
  src: string;
  alt: string;
  label?: string;
  triggerClassName?: string;
  imgClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} className={`cursor-zoom-in ${triggerClassName}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={imgClassName} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-8"
        >
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/30 transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
              <path d="M6 6l12 12M6 18 18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[95vw] rounded-bmpl-md object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}

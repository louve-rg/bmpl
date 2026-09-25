'use client';

import { useEffect, useRef } from 'react';

/**
 * The full-screen shell half of the BMPL-182 expandable-map pattern.
 *
 * Deliberately generic — it knows nothing about maps, points or pins. It just
 * takes over the viewport, locks page scroll while open (the same technique
 * `EnlargeableImage` already uses for its photo lightbox), and gives the
 * caller a header, a body slot and a primary "confirm and return" action.
 * ExpandableRouteMap fills the body with a bigger read-only `MapPreview`
 * today; a future pin-adjustable card can fill it with `LocationPicker`
 * instead without copying this shell.
 *
 * Closes on the ✕ button, Escape, or the confirm action — never on a tap
 * inside the body, because on a map that tap is a pan or a marker select, not
 * a dismissal.
 */
export function FullScreenMapModal({
  open,
  onClose,
  title,
  confirmLabel = 'Done',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  confirmLabel?: string;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[100] flex flex-col bg-white">
      <div className="flex min-h-[56px] shrink-0 items-center justify-between border-b border-slate-200 px-3">
        <p className="truncate text-sm font-semibold text-belize-navy">{title}</p>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close map"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-bmpl-md text-slate-500 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-blue"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path d="M6 6l12 12M6 18 18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* min-h-0 so the flex child can actually shrink and scroll/pan its own
          content instead of stretching the dialog past the viewport. */}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

      <div className="shrink-0 border-t border-slate-200 p-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-[48px] w-full items-center justify-center rounded-bmpl-md bg-belize-blue text-base font-semibold text-white transition hover:bg-belize-deep"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

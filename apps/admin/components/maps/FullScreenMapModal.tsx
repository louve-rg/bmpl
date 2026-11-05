'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../../lib/use-body-scroll-lock';
import { useDialogFocusTrap } from '../../lib/use-dialog-focus-trap';

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
 *
 * MDF-485 M1/M2: `onConfirm`, separate from `onClose`, is what gives a caller
 * an actual confirm-or-cancel choice rather than one action with two buttons.
 * Without it (the original, still-default shape) both the ✕/Escape and the
 * bottom button just call `onClose` — fine for a read-only body like
 * `ExpandableRouteMap`'s, where there is nothing to discard. `LocationPicker`
 * passes `onConfirm` because its full-screen body edits a draft pin that must
 * NOT reach the caller on a dismiss, only on an explicit confirm.
 *
 * Focus containment, background isolation and return-to-opener (BMPL-208)
 * are `useDialogFocusTrap` — the same hook `EnlargeableImage` uses, so the
 * two dialogs cannot drift apart on this again.
 *
 * SOURCE OF TRUTH: apps/web/components/maps/FullScreenMapModal.tsx. PORTED
 * FROM THERE verbatim (MDF-538), together with MapPreview.tsx,
 * cooperative-map-drag.ts and trip-map.ts's MapPoint/labelStops -- a near-
 * duplicate, not a refactor of it. A fix made to one copy must be applied
 * to the other; this is a known, accepted duplication, not a drift to
 * tolerate. The first plan was a single copy shared from packages/ui
 * (apps/admin already depends on it, and these four files have no
 * @bmpl/web-specific imports), but packages/ui's build is plain `tsc` with
 * `module: commonjs`, which rewrites a dynamic `import('leaflet')` into a
 * synchronous `require()` wrapped in a resolved promise -- confirmed by
 * compiling a throwaway file through its real tsconfig, not assumed. That
 * breaks the entire point of loading Leaflet lazily (webpack's code-splitting
 * keys off the literal `import()` syntax, not a deferred require), so
 * LocationPicker.tsx (apps/web, which still owns the only dynamic import of
 * 'leaflet' in these four files -- this one doesn't import it directly)
 * would risk shipping Leaflet into chunks that shouldn't have it. Two
 * Leaflet implementations to keep in step is the real cost, paid here on
 * purpose rather than risk a build regression in a package both apps depend
 * on.
 */
export function FullScreenMapModal({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel = 'Done',
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Called by the bottom button only. Defaults to `onClose` when omitted, so every existing caller is unchanged. */
  onConfirm?: () => void;
  title: string;
  confirmLabel?: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useDialogFocusTrap({ open, containerRef, initialFocusRef: closeRef });
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={containerRef}
      data-theme="light"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex flex-col bg-white"
    >
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
          onClick={onConfirm ?? onClose}
          className="flex min-h-[48px] w-full items-center justify-center rounded-bmpl-md bg-belize-blue text-base font-semibold text-white transition hover:bg-belize-deep"
        >
          {confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}

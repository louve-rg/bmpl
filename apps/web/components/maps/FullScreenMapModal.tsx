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
 * Focus containment, background isolation and return-to-opener (BMPL-208)
 * are `useDialogFocusTrap` — the same hook `EnlargeableImage` uses, so the
 * two dialogs cannot drift apart on this again.
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

  // Portaled to document.body, not rendered in place: a caller can embed this
  // modal anywhere, including inside a `bmpl-card` with its own
  // `backdrop-filter`. A `backdrop-filter` on an ancestor establishes a new
  // containing block for a descendant `position: fixed` element, so without
  // the portal this "fixed, full-viewport" dialog pins to that card's box
  // instead of the viewport -- confirmed on /dashboard/store's LocationPicker
  // (measured rect {top:394, bottom:949, height:555} against an 844px
  // viewport, with the confirm button entirely below the fold). Same
  // mechanism MobileNavDrawer.tsx already hit and fixed; same fix here.
  //
  // data-theme="light" reapplied on the portaled root: escaping to
  // document.body also escapes any [data-theme] ancestor in the DOM, not
  // just its backdrop-filter containing block, so a caller's children that
  // read adaptive --bmpl-* tokens (LocationPickerBody's "Loading map..."
  // fallback does, var(--bmpl-text-muted-strong)) would otherwise render
  // against whatever theme happened to be ambient before portaling.
  //
  // CORRECTION (2026-10-22, found while enumerating .bmpl-surface-onlight
  // usages for a separate task): this used to say data-theme="glass", by
  // direct analogy to MobileNavDrawer.tsx:77-84. That analogy doesn't hold
  // here -- MobileNavDrawer's panel is `.bmpl-overlay`, an ADAPTIVE surface
  // whose own background genuinely IS the glass colour, so its content
  // correctly wants glass values. THIS dialog's panel below is a literal,
  // always-opaque `bg-white` -- never adaptive, portaled or not -- so
  // anything inside it that reads an adaptive text token always wants the
  // LIGHT value, the same structural fix as InfoCard/NotificationBell/
  // ServiceTypeField tonight. "glass" was never correct; it happened to go
  // unnoticed because the only affected node (the loading fallback) is a
  // transient state nothing measured directly.
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
          onClick={onClose}
          className="flex min-h-[48px] w-full items-center justify-center rounded-bmpl-md bg-belize-blue text-base font-semibold text-white transition hover:bg-belize-deep"
        >
          {confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}

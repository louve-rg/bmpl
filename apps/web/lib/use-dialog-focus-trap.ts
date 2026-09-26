'use client';

import { useEffect, useRef } from 'react';

/**
 * The keyboard/focus half of a full-screen dialog — BMPL-208.
 *
 * FullScreenMapModal and EnlargeableImage's lightbox each declared
 * aria-modal="true" but never enforced it: Tab walked straight out into the
 * page behind them, the background stayed live in the accessibility tree,
 * and closing left focus wherever it had drifted instead of returning it to
 * whatever opened the dialog. Both had the identical shape independently —
 * exactly the drift a shared primitive exists to prevent. Extracted once,
 * used by both, so neither can silently regress without the other.
 *
 * While `open`, keyed on `containerRef` (the dialog's own root element):
 * - focus moves onto `initialFocusRef` the moment the dialog opens — both
 *   callers already did this individually; consolidated here so it can
 *   never drift from the rest of the behaviour below;
 * - the element that had focus just before opening is remembered and
 *   refocused when the dialog closes — the WCAG "return focus to the
 *   trigger" pattern neither prior implementation had;
 * - Tab and Shift+Tab are contained inside the dialog's focusable
 *   descendants, computed fresh on every keypress so dialogs whose content
 *   changes (a legend list, a form) stay correct;
 * - every element OUTSIDE the dialog is marked `inert`, walking up from the
 *   dialog to <body> and inerting siblings at each level. `inert` removes
 *   an element from both tab order and the accessibility tree in one
 *   native, standard operation — the browser's own answer to "hide
 *   everything else", requiring no cooperation from whatever happens to be
 *   mounted there. This is what makes aria-modal="true" actually true
 *   instead of an unenforced promise a screen reader may trust anyway.
 *
 * Callers keep their own visual shell (backdrop, close button, styling)
 * and their own Escape-to-close and body-scroll-lock effects — those were
 * already correct and identical in both, and are left as they are; this
 * hook owns only the focus behaviour that had drifted.
 */
export function useDialogFocusTrap({
  open,
  containerRef,
  initialFocusRef,
}: {
  open: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  /** Focused the instant the dialog opens — typically the close button. */
  initialFocusRef: React.RefObject<HTMLElement | null>;
}): void {
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef.current?.focus();

    // Walk up from the dialog to <body>, inerting siblings at every level.
    // The ancestor chain that leads TO the dialog is never touched — only
    // the branches that don't.
    const inerted: Element[] = [];
    let node: Element = container;
    while (node !== document.body && node.parentElement) {
      const parent = node.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== node && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '');
          inerted.push(sibling);
        }
      }
      node = parent;
    }

    function focusableIn(root: HTMLElement): HTMLElement[] {
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
        // getComputedStyle, not offsetParent: offsetParent depends on layout
        // (always null in a test DOM with no renderer, and null for other
        // legitimately-visible positioning contexts too) — display is the
        // portable way to ask "is this actually excluded from tab order".
      ).filter((el) => getComputedStyle(el).display !== 'none');
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !container) return;
      const focusable = focusableIn(container);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      for (const el of inerted) el.removeAttribute('inert');
      opener?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

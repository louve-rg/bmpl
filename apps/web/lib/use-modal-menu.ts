'use client';

import { useEffect } from 'react';

/** Everything that can hold focus inside a menu panel. */
export const MENU_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The menu-panel behaviour the dashboard drawer established (P1 of the nav
 * plan): while `open`, focus moves into the panel, Tab is trapped inside it,
 * Escape closes it, background scrolling is locked, and focus returns to the
 * trigger on close.
 *
 * Deliberately NOT the same as `useDialogFocusTrap`: that hook also marks the
 * page behind `inert`. A slide-out nav menu does not need that, and adding it
 * to the public header would change what the page behind it can reach.
 *
 * A press outside the panel (not on the trigger) also closes it. The dashboard
 * drawer's scrim already did that; the hook now does it for every caller.
 *
 * Callers own their visual shell, their own close on navigation, and the
 * trigger/panel refs. This hook owns only the behaviours above.
 */
export function useModalMenu({
  open,
  onClose,
  panelRef,
  triggerRef,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: React.RefObject<HTMLElement | null>;
  triggerRef: React.RefObject<HTMLElement | null>;
}): void {
  // Lock background scroll while open. The previous overflow is restored rather
  // than hard-set to '', so a page that legitimately sets its own is unharmed.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // A press outside the panel closes it. The trigger is outside the panel too, so
  // it is excluded: otherwise tapping the trigger closes the menu and the same
  // tap reopens it, and the button looks dead. Desktop groups and the account
  // menu already close this way; the mobile list did not.
  useEffect(() => {
    if (!open) return;
    function onPress(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener('mousedown', onPress);
    document.addEventListener('touchstart', onPress);
    return () => {
      document.removeEventListener('mousedown', onPress);
      document.removeEventListener('touchstart', onPress);
    };
    // Refs are stable; the handler follows onClose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  // Move focus into the panel on open, and back to the trigger on close, so a
  // keyboard or screen-reader user is not left at the top of the document.
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(MENU_FOCUSABLE);
    first?.focus();
    return () => triggerRef.current?.focus();
    // Refs are stable; only the open transition matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes; Tab cycles within the panel.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(MENU_FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);
}

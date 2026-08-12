'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandLockup } from '../Logo';
import { Avatar } from '../Avatar';
import { RoleSwitcher } from './RoleSwitcher';
import { LogoutButton } from './LogoutButton';
import { DashboardNavList } from './DashboardNavList';
import type { MeView } from '../../lib/types';
import { useUnreadMessages } from '../../lib/use-unread-messages';

/** Everything that can hold focus inside the panel. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The phone/tablet dashboard navigation: a hamburger in the header that opens a
 * proper off-canvas drawer.
 *
 * The previous mobile nav expanded INLINE at the top of the page, pushing the
 * driver's work down the screen and, once open, off it. A drawer overlays
 * instead, so the page beneath keeps the full viewport width when it is closed —
 * which is what the client actually asked for.
 *
 * Accessibility is the substance of this component, not decoration on it:
 * focus moves in on open and back to the trigger on close, Tab is trapped inside
 * the panel, Escape closes, the background is inert to pointer and to screen
 * readers (`aria-hidden` on the app shell is not needed because the overlay
 * covers it and focus cannot leave), and background scrolling is locked so the
 * page behind does not slide around under the drawer.
 */
export function MobileNavDrawer({ me }: { me: MeView }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const unread = useUnreadMessages();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Any navigation closes it — including a browser back/forward, which a
  // click-handler-only close would miss.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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

  // Move focus into the panel on open, and back to the hamburger on close, so a
  // keyboard or screen-reader user is not left at the top of the document.
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => triggerRef.current?.focus();
  }, [open]);

  // Escape closes; Tab cycles within the panel.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
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
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="dashboard-mobile-nav"
        aria-label="Open navigation menu"
        className="inline-flex h-11 w-11 items-center justify-center rounded-bmpl-md text-slate-600 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent md:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Scrim. Clicking it closes; it is not a control, so it is hidden from
              assistive tech — Escape and the in-panel Close button are the
              accessible ways out. */}
          <div className="absolute inset-0 bg-belize-navy/40" onClick={close} aria-hidden />

          <div
            ref={panelRef}
            id="dashboard-mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard navigation"
            // w-[min(20rem,85vw)] keeps the scrim visible (so it reads as a
            // drawer, not a page) and fits inside a 320px viewport.
            className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] max-w-full flex-col overflow-y-auto overscroll-contain bg-white shadow-bmpl-md"
            // Safe areas: on an iPhone the drawer runs under the notch and the
            // home indicator, and without this the first nav item and the logout
            // button are partly unreachable.
            style={{
              paddingTop: 'env(safe-area-inset-top)',
              paddingBottom: 'env(safe-area-inset-bottom)',
              paddingLeft: 'env(safe-area-inset-left)',
            }}
          >
            <div className="flex items-center justify-between gap-2 p-4">
              <Link href="/" onClick={close} className="rounded-bmpl-lg bg-belize-navy p-2">
                <BrandLockup />
              </Link>
              <button
                type="button"
                onClick={close}
                aria-label="Close navigation menu"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-bmpl-md text-slate-600 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
              <RoleSwitcher me={me} />
              <DashboardNavList me={me} unread={unread} onNavigate={close} />

              <div className="mt-auto border-t border-slate-100 pt-4">
                <Link
                  href="/dashboard/profile"
                  onClick={close}
                  className="mb-2 flex items-center gap-3 rounded-bmpl-md px-3 py-2 transition hover:bg-slate-50"
                >
                  <Avatar name={`${me.firstName} ${me.lastName}`} src={me.avatarUrl} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-belize-navy">
                      {me.firstName} {me.lastName}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{me.email}</span>
                  </span>
                </Link>
                <LogoutButton />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BrandLockup } from '../Logo';
import { ButtonLink } from '../ui';
import { CartButton } from '../cart/CartButton';
import { SavedNavButton } from '../saved/SavedNavButton';
import { AnnouncementBanner } from '../AnnouncementBanner';
import { api } from '../../lib/api';
import { PUBLIC_NAV } from '../../lib/public-nav';
import { AccountMenu } from '../account/AccountMenu';
import type { MeView } from '../../lib/types';
import { useModalMenu } from '../../lib/use-modal-menu';


export function Header() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  // undefined = still checking, null = signed out, MeView = signed in.
  const [me, setMe] = useState<MeView | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    api
      .get<MeView>('/me')
      .then((m) => active && setMe(m))
      .catch(() => active && setMe(null));
    return () => {
      active = false;
    };
  }, []);

  // Escape, focus in/return, Tab trap and scroll lock for the mobile list (P2).
  useModalMenu({ open, onClose: closeMenu, panelRef, triggerRef: toggleRef });

  // The list is only shown below lg. If the window grows past it while open,
  // close it, so scroll is not left locked behind an invisible menu.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  // Sign-out lives in AccountMenu; the header only drops its own signed-in state.
  const signedOut = () => {
    setMe(null);
    setOpen(false);
  };

  return (
    <>
      <AnnouncementBanner />
      <header className="sticky top-0 z-50 bg-belize-navy/95 backdrop-blur supports-[backdrop-filter]:bg-belize-navy/80">
      {/* The desktop nav switches in at `lg`, not `md`. At exactly 768px the
          brand, five nav links and four account controls measured 978px against
          a 768px viewport — a tablet in portrait scrolled sideways on every
          public page. They fit from 1024px; below that the hamburger is correct. */}
      <nav className="container-bmpl flex h-16 items-center justify-between" aria-label="Primary">
        <Link href="/" aria-label="Belize Marketplace & Logistics home">
          <BrandLockup />
        </Link>

        <div className="hidden items-center gap-7 lg:flex">
          {PUBLIC_NAV.map((item) => (
            <a key={item.label} href={item.href} className="text-sm font-medium text-blue-100 transition hover:text-white">
              {item.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <SavedNavButton />
          <CartButton />
          {me === undefined ? (
            <span className="h-8 w-28 animate-pulse rounded-lg bg-white/10" aria-hidden />
          ) : me ? (
            <AccountMenu me={me} tone="dark" afterSignOut="/" onSignedOut={signedOut} />
          ) : (
            <>
              <ButtonLink href="/login" variant="ghostLight" size="sm">
                Sign in
              </ButtonLink>
              <ButtonLink href="/register" variant="accent" size="sm">
                Create account
              </ButtonLink>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 lg:hidden">
          <SavedNavButton />
          <CartButton />
          <button
            className="inline-flex items-center rounded-md p-2 text-white"
            ref={toggleRef}
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="public-mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {open ? <path d="M6 6l12 12M6 18L18 6" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div
          ref={panelRef}
          id="public-mobile-nav"
          className="border-t border-white/10 bg-belize-navy lg:hidden"
        >
          <div className="container-bmpl flex flex-col gap-1 py-3">
            {PUBLIC_NAV.map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded px-2 py-2 text-blue-100 hover:bg-white/5 hover:text-white"
              >
                {item.label}
              </a>
            ))}

            {me === undefined ? null : me ? (
              <div className="mt-2 border-t border-white/10 pt-2">
                <AccountMenu me={me} tone="dark" afterSignOut="/" onSignedOut={signedOut} onNavigate={() => setOpen(false)} />
              </div>
            ) : (
              <div className="mt-2 flex gap-3">
                <ButtonLink href="/login" variant="outline" size="sm" className="flex-1 !border-white !text-white">
                  Sign in
                </ButtonLink>
                <ButtonLink href="/register" variant="accent" size="sm" className="flex-1">
                  Create account
                </ButtonLink>
              </div>
            )}
          </div>
        </div>
      )}
      </header>
    </>
  );
}

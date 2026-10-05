'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandLockup } from '../Logo';
import { ButtonLink } from '../ui';
import { CartButton } from '../cart/CartButton';
import { SavedNavButton } from '../saved/SavedNavButton';
import { AnnouncementBanner } from '../AnnouncementBanner';
import { api } from '../../lib/api';
import { PUBLIC_NAV_GROUPS, PUBLIC_NAV_HOME, isGroupCurrent, isItemCurrent } from '../../lib/public-nav';
import { AccountMenu } from '../account/AccountMenu';
import type { MeView } from '../../lib/types';
import { useModalMenu } from '../../lib/use-modal-menu';


export function Header() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  const desktopNavRef = useRef<HTMLDivElement>(null);
  // undefined = still checking, null = signed out, MeView = signed in.
  const [me, setMe] = useState<MeView | null | undefined>(undefined);
  // The page the visitor is on, for aria-current. Read after mount, not during
  // render, so the server and the first paint agree. The nav links are plain
  // anchors, so a change of query (Sale to Rent) is a full load and this re-reads.
  const pathname = usePathname();
  const [here, setHere] = useState({ path: '', search: '' });
  useEffect(() => {
    setHere({ path: window.location.pathname, search: window.location.search });
  }, [pathname]);

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

  // Desktop groups are native <details>. The browser does not close them on Escape
  // or on a click outside, so this does: Escape closes the open group and returns
  // focus to its summary; a click outside closes it; opening one group closes the
  // others, so only one dropdown is ever open.
  useEffect(() => {
    const root = desktopNavRef.current;
    if (!root) return;
    const closeAll = (except?: Element) => {
      root.querySelectorAll('details[open]').forEach((d) => {
        if (d !== except) d.removeAttribute('open');
      });
    };
    const onToggle = (e: Event) => {
      const target = e.target as HTMLDetailsElement;
      if (target.open) closeAll(target);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const open = root.querySelector<HTMLDetailsElement>('details[open]');
      if (!open) return;
      open.removeAttribute('open');
      open.querySelector('summary')?.focus();
    };
    const onPointer = (e: MouseEvent) => {
      if (!root.contains(e.target as Node)) closeAll();
    };
    // toggle does not bubble, so it is listened for in the capture phase on the container.
    root.addEventListener('toggle', onToggle, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointer);
    return () => {
      root.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointer);
    };
  }, []);

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

        <div ref={desktopNavRef} className="hidden items-center gap-2 lg:flex xl:gap-4">
          <a
            href={PUBLIC_NAV_HOME.href}
            aria-current={here.path === PUBLIC_NAV_HOME.href ? 'page' : undefined}
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center text-sm font-medium text-blue-100 transition hover:text-white ${here.path === PUBLIC_NAV_HOME.href ? 'underline underline-offset-4 decoration-2' : ''}`}
          >
            {PUBLIC_NAV_HOME.label}
          </a>
          {PUBLIC_NAV_GROUPS.map((group) => {
            const groupCurrent = isGroupCurrent(group, here.path, here.search);
            return (
              // Native <details>: keyboard and screen-reader behaviour come from the
              // browser, with no hover-only menu to get wrong. Each group is one
              // labelled disclosure with its real destinations inside.
              <details key={group.heading} className="group relative">
                <summary
                  aria-current={groupCurrent ? 'true' : undefined}
                  className={`flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-sm font-medium text-blue-100 transition hover:text-white ${groupCurrent ? 'underline underline-offset-4 decoration-2' : ''}`}
                >
                  {group.heading}
                  <span aria-hidden className="text-xs transition group-open:rotate-180">▾</span>
                </summary>
                <div className="absolute left-0 top-full z-50 mt-3 flex min-w-[14rem] flex-col gap-1 rounded-bmpl-md bg-belize-navy p-2 shadow-bmpl-md ring-1 ring-white/10">
                  {group.items.map((item) => {
                    const current = isItemCurrent(item.href, here.path, here.search);
                    return (
                      <a
                        key={item.label}
                        href={item.href}
                        aria-current={current ? 'page' : undefined}
                        className={`flex min-h-[44px] items-center rounded px-3 py-2 text-sm text-blue-100 hover:bg-white/5 hover:text-white ${current ? 'font-semibold text-white underline underline-offset-4 decoration-2' : ''}`}
                      >
                        {item.label}
                      </a>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <SavedNavButton className="min-h-[44px] min-w-[44px]" />
          <CartButton className="min-h-[44px] min-w-[44px]" />
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
          <SavedNavButton className="min-h-[44px] min-w-[44px]" />
          <CartButton className="min-h-[44px] min-w-[44px]" />
          <button
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white"
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
          // The menu is taller than a phone screen, and the page behind is locked
          // while it is open. So the menu itself has to scroll: bounded to the
          // screen below the 4rem header, scrolling inside, and not chaining to the
          // locked page. dvh where supported (it excludes the mobile browser toolbar),
          // vh as the fallback.
          className="max-h-[calc(100vh-4rem)] overflow-y-auto overscroll-contain supports-[height:100dvh]:max-h-[calc(100dvh-4rem)] border-t border-white/10 bg-belize-navy lg:hidden"
        >
          <div className="container-bmpl flex flex-col gap-1 py-3">
            <a
              href={PUBLIC_NAV_HOME.href}
              onClick={() => setOpen(false)}
              aria-current={here.path === PUBLIC_NAV_HOME.href ? 'page' : undefined}
              className={`flex min-h-[44px] items-center rounded px-2 py-2 font-medium text-white hover:bg-white/5 ${here.path === PUBLIC_NAV_HOME.href ? 'underline underline-offset-4 decoration-2' : ''}`}
            >
              {PUBLIC_NAV_HOME.label}
            </a>
            {PUBLIC_NAV_GROUPS.map((group) => {
              const groupCurrent = isGroupCurrent(group, here.path, here.search);
              return (
                <div key={group.heading} className="mt-2 flex flex-col gap-1">
                  <p
                    aria-current={groupCurrent ? 'true' : undefined}
                    className={`px-2 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-belize-light ${groupCurrent ? 'underline underline-offset-4 decoration-2' : ''}`}
                  >
                    {group.heading}
                  </p>
                  {group.items.map((item) => {
                    const current = isItemCurrent(item.href, here.path, here.search);
                    return (
                      <a
                        key={item.label}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={current ? 'page' : undefined}
                        className={`flex min-h-[44px] items-center rounded px-2 py-2 text-blue-100 hover:bg-white/5 hover:text-white ${current ? 'font-semibold text-white underline underline-offset-4 decoration-2' : ''}`}
                      >
                        {item.label}
                      </a>
                    );
                  })}
                </div>
              );
            })}

            {me === undefined ? null : me ? (
              <div className="mt-2 border-t border-white/10 pt-2">
                <AccountMenu me={me} tone="dark" afterSignOut="/" onSignedOut={signedOut} onNavigate={() => setOpen(false)} />
              </div>
            ) : (
              <div className="mt-2 flex gap-3">
                <ButtonLink href="/login" variant="outline" size="sm" className="min-h-[44px] flex-1 !border-white !text-white">
                  Sign in
                </ButtonLink>
                <ButtonLink href="/register" variant="accent" size="sm" className="min-h-[44px] flex-1">
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

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BrandLockup } from '../Logo';
import { ButtonLink } from '../ui';
import { CartButton } from '../cart/CartButton';
import { SavedNavButton } from '../saved/SavedNavButton';
import { AnnouncementBanner } from '../AnnouncementBanner';
import { api } from '../../lib/api';
import type { MeView } from '../../lib/types';

// Anchor links point at the landing page ("/#…") so they work from any route,
// not just when the visitor is already on "/".
const NAV = [
  { label: 'Shop', href: '/products' },
  { label: 'Vendors', href: '/vendors' },
  { label: 'Jobs', href: '/jobs' },
  { label: 'Services', href: '/#services' },
  { label: 'For Providers', href: '/#providers' },
  { label: 'Wallet', href: '/#wallet' },
  { label: 'Mobile App', href: '/#mobile' },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
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

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore — clear local state regardless */
    }
    setMe(null);
    setOpen(false);
    router.push('/');
    router.refresh();
  }

  const initials = me ? `${me.firstName?.[0] ?? ''}${me.lastName?.[0] ?? ''}`.toUpperCase() || 'U' : '';

  return (
    <>
      <AnnouncementBanner />
      <header className="sticky top-0 z-50 bg-belize-navy/95 backdrop-blur supports-[backdrop-filter]:bg-belize-navy/80">
      <nav className="container-bmpl flex h-16 items-center justify-between" aria-label="Primary">
        <Link href="/" aria-label="Belize Marketplace & Logistics home">
          <BrandLockup />
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <a key={item.label} href={item.href} className="text-sm font-medium text-blue-100 transition hover:text-white">
              {item.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <SavedNavButton />
          <CartButton />
          {me === undefined ? (
            <span className="h-8 w-28 animate-pulse rounded-lg bg-white/10" aria-hidden />
          ) : me ? (
            <>
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-medium text-white transition hover:bg-white/10"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-belize-accent text-xs font-bold text-white">
                  {initials}
                </span>
                <span className="max-w-[10rem] truncate">{me.firstName}</span>
              </Link>
              <button onClick={logout} className="text-sm font-medium text-blue-100 transition hover:text-white">
                Sign out
              </button>
            </>
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

        <div className="flex items-center gap-1 md:hidden">
          <SavedNavButton />
          <CartButton />
          <button
            className="inline-flex items-center rounded-md p-2 text-white"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {open ? <path d="M6 6l12 12M6 18L18 6" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-white/10 bg-belize-navy md:hidden">
          <div className="container-bmpl flex flex-col gap-1 py-3">
            {NAV.map((item) => (
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
              <div className="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2">
                <Link href="/dashboard" onClick={() => setOpen(false)} className="rounded px-2 py-2 font-medium text-white hover:bg-white/5">
                  Dashboard
                </Link>
                <Link href="/orders" onClick={() => setOpen(false)} className="rounded px-2 py-2 text-blue-100 hover:bg-white/5 hover:text-white">
                  My orders
                </Link>
                <button onClick={logout} className="rounded px-2 py-2 text-left text-blue-100 hover:bg-white/5 hover:text-white">
                  Sign out
                </button>
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

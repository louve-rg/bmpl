'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { savedApi, SAVED_CHANGED } from '../../lib/saved';

/**
 * Wishlist icon with a live saved-count badge. Fetches the count on mount and
 * whenever a `saved:changed` event fires (e.g. after toggling a heart).
 * Logged-out visitors simply see the icon with no badge; the /wishlist page
 * handles the sign-in prompt.
 */
export function SavedNavButton({ className = '' }: { className?: string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      savedApi
        .count()
        .then((c) => active && setCount(c.count))
        .catch(() => active && setCount(null));
    load();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ count?: number }>).detail;
      if (detail && typeof detail.count === 'number') setCount(detail.count);
      else load();
    };
    window.addEventListener(SAVED_CHANGED, onChange);
    return () => {
      active = false;
      window.removeEventListener(SAVED_CHANGED, onChange);
    };
  }, []);

  return (
    <Link
      href="/wishlist"
      aria-label={count ? `Wishlist, ${count} item${count === 1 ? '' : 's'}` : 'Wishlist'}
      className={`relative inline-flex items-center justify-center rounded-md p-2 text-blue-100 transition hover:text-white ${className}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      {count ? (
        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-belize-accent px-1 text-[11px] font-bold leading-none text-white">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}

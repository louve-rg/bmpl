'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cartApi, CART_CHANGED } from '../../lib/cart';

/**
 * Cart icon with a live item-count badge. Fetches the count on mount and
 * whenever a `cart:changed` event fires (e.g. after Add to Cart). Logged-out
 * visitors simply see the icon with no badge; the /cart page handles the
 * sign-in redirect.
 */
export function CartButton({ className = '' }: { className?: string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      cartApi
        .get()
        .then((c) => active && setCount(c.itemCount))
        .catch(() => active && setCount(null));
    load();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ count?: number }>).detail;
      if (detail && typeof detail.count === 'number') setCount(detail.count);
      else load();
    };
    window.addEventListener(CART_CHANGED, onChange);
    return () => {
      active = false;
      window.removeEventListener(CART_CHANGED, onChange);
    };
  }, []);

  return (
    <Link
      href="/cart"
      aria-label={count ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart'}
      className={`relative inline-flex items-center justify-center rounded-md p-2 text-blue-100 transition hover:text-white ${className}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      {count ? (
        <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-belize-accent px-1 text-[11px] font-bold leading-none text-white">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}

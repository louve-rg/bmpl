'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  savedApi,
  fetchSavedIds,
  invalidateSavedIds,
  notifySavedChanged,
  SAVED_CHANGED,
} from '../../lib/saved';
import type { ApiError } from '../../lib/api';

type Size = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<Size, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

const BTN_PAD: Record<Size, string> = {
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-2.5',
};

/**
 * Heart toggle island — safe to drop over server-rendered cards. Resolves its
 * saved state from the deduped `fetchSavedIds()` cache on mount (unless
 * `initialSaved` is supplied), and stays in sync across the page via the
 * SAVED_CHANGED event. Clicks are optimistic with rollback on error; guests
 * (401) are routed to login.
 */
export function SaveButton({
  productId,
  size = 'md',
  className = '',
  initialSaved,
}: {
  productId: string;
  size?: Size;
  className?: string;
  initialSaved?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<boolean>(initialSaved ?? false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (initialSaved === undefined) {
      fetchSavedIds()
        .then((ids) => active && setSaved(ids.has(productId)))
        .catch(() => {
          /* guests / errors: leave as not-saved */
        });
    }
    // Keep in sync when other hearts or the wishlist page mutate the set.
    const onChange = () => {
      fetchSavedIds()
        .then((ids) => active && setSaved(ids.has(productId)))
        .catch(() => {});
    };
    window.addEventListener(SAVED_CHANGED, onChange);
    return () => {
      active = false;
      window.removeEventListener(SAVED_CHANGED, onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const next = !saved;
    setSaved(next); // optimistic
    setBusy(true);
    try {
      if (next) await savedApi.save(productId);
      else await savedApi.unsave(productId);
      invalidateSavedIds();
      notifySavedChanged();
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        router.push(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      setSaved(!next); // rollback
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? 'Saved' : 'Save'}
      title={saved ? 'Saved' : 'Save'}
      className={`inline-flex items-center justify-center rounded-full ${BTN_PAD[size]} transition disabled:opacity-60 ${
        saved
          ? 'text-belize-accent hover:text-belize-accent'
          : 'text-slate-400 hover:text-belize-accent'
      } ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className={SIZE_PX[size]}
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}

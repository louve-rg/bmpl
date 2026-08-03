'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  savedApi,
  fetchSaved,
  invalidateSaved,
  isVariantSaved,
  notifySavedChanged,
  CHOOSE_OPTIONS_MESSAGE,
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
 * Heart toggle island — variant-aware. Its saved state reflects the EXACT
 * (productId, variantId) currently in view: switching the selected variant on a
 * product page flips the heart. Resolves from the deduped `fetchSaved()` cache on
 * mount (unless `initialSaved` is supplied) and stays in sync across the page via
 * SAVED_CHANGED. Clicks are optimistic with rollback on error; guests (401) route
 * to login.
 *
 * A variant product must never save its parent:
 *  - Product detail (options known): pass `hasVariants` + the selected `variantId`.
 *    When the product has variants but none is selected, a click surfaces the
 *    "Choose your options" hint (via `onNotice`) instead of saving.
 *  - Cards (no option UI): pass `productSlug`. If the API rejects a parent-level
 *    save with the choose-options message, the user is routed to the product page
 *    to pick options — the parent is never saved.
 */
export function SaveButton({
  productId,
  variantId = null,
  hasVariants = false,
  productSlug,
  size = 'md',
  className = '',
  initialSaved,
  onNotice,
}: {
  productId: string;
  /** The exact selected variant id; null/omitted for a product-level heart. */
  variantId?: string | null;
  /** Whether the product has variant options (detail page knows this). */
  hasVariants?: boolean;
  /** Product slug — enables routing to the product page to choose options (cards). */
  productSlug?: string;
  size?: Size;
  className?: string;
  initialSaved?: boolean;
  /** Surface a message (e.g. the choose-options hint) to the host UI. */
  onNotice?: (message: string) => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<boolean>(initialSaved ?? false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const resolve = () =>
      fetchSaved()
        .then((keys) => active && setSaved(isVariantSaved(keys, productId, variantId)))
        .catch(() => {
          /* guests / errors: leave as not-saved */
        });
    if (initialSaved === undefined) resolve();
    // Keep in sync when other hearts or the wishlist page mutate the set.
    const onChange = () => resolve();
    window.addEventListener(SAVED_CHANGED, onChange);
    return () => {
      active = false;
      window.removeEventListener(SAVED_CHANGED, onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, variantId]);

  function requireOptions() {
    if (productSlug) {
      // Card context: no option UI here — send the shopper to choose options.
      router.push(`/products/${productSlug}`);
      return;
    }
    onNotice?.(CHOOSE_OPTIONS_MESSAGE);
  }

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;

    const next = !saved;
    // Saving a variant product with no concrete variant chosen: never save the
    // parent — prompt for options instead (detail page short-circuits the call).
    if (next && hasVariants && !variantId) {
      requireOptions();
      return;
    }

    setSaved(next); // optimistic
    setBusy(true);
    try {
      if (next) await savedApi.save(productId, variantId);
      else await savedApi.unsave(productId, variantId);
      invalidateSaved();
      notifySavedChanged();
    } catch (err) {
      const e = err as ApiError;
      setSaved(!next); // rollback
      if (e.status === 401) {
        const dest = `${window.location.pathname}${window.location.search}`;
        router.push(`/login?next=${encodeURIComponent(dest)}`);
        return;
      }
      // A variant product hearted from a card (no variantId) → the API tells us to
      // choose options; route to the product page rather than showing an error.
      if (e.status === 400) {
        requireOptions();
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  const needsOptions = hasVariants && !variantId;
  const label = saved
    ? 'Remove from Wishlist'
    : needsOptions
      ? 'Choose your options to add to Wishlist'
      : 'Add to Wishlist';

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      aria-label={label}
      title={label}
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

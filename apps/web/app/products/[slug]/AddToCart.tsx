'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cartApi, money, notifyCartChanged } from '../../../lib/cart';
import type { ApiError } from '../../../lib/api';

interface OptionValue {
  id: string;
  value: string;
}
interface Option {
  id: string;
  name: string;
  values: OptionValue[];
}
interface Variant {
  id: string;
  priceMinor: number | null;
  salePriceMinor: number | null;
  optionValueIds: string[];
  availability: { inStock: boolean; outOfStock: boolean };
}

export function AddToCart({
  productId,
  slug,
  options,
  variants,
  productInStock,
  basePriceMinor,
  baseSalePriceMinor,
}: {
  productId: string;
  slug: string;
  options: Option[];
  variants: Variant[];
  productInStock: boolean;
  basePriceMinor: number;
  baseSalePriceMinor: number | null;
}) {
  const router = useRouter();
  const hasVariants = variants.length > 0;
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Resolve the chosen option values to a concrete variant (all options picked).
  const selectedVariant = useMemo(() => {
    if (!hasVariants) return null;
    if (Object.keys(selection).length !== options.length) return null;
    const chosen = new Set(Object.values(selection));
    return (
      variants.find(
        (v) => v.optionValueIds.length === chosen.size && v.optionValueIds.every((id) => chosen.has(id)),
      ) ?? null
    );
  }, [hasVariants, selection, options.length, variants]);

  const effectivePrice = selectedVariant
    ? selectedVariant.salePriceMinor ?? selectedVariant.priceMinor ?? baseSalePriceMinor ?? basePriceMinor
    : baseSalePriceMinor ?? basePriceMinor;

  const needsVariant = hasVariants && !selectedVariant;
  const outOfStock = selectedVariant ? selectedVariant.availability.outOfStock : hasVariants ? false : !productInStock;
  const disabled = busy || needsVariant || outOfStock;

  async function add() {
    setBusy(true);
    setMessage(null);
    try {
      const cart = await cartApi.add({ productId, variantId: selectedVariant?.id ?? null, quantity: qty });
      notifyCartChanged(cart.itemCount);
      setMessage({ kind: 'ok', text: 'Added to your cart.' });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/products/${slug}`)}`);
        return;
      }
      setMessage({ kind: 'err', text: err.message || 'Could not add to cart.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bmpl-card mt-6 p-5">
      {hasVariants && (
        <div className="space-y-3">
          {options.map((opt) => (
            <div key={opt.id}>
              <label htmlFor={`opt-${opt.id}`} className="bmpl-label">
                {opt.name}
              </label>
              <select
                id={`opt-${opt.id}`}
                value={selection[opt.id] ?? ''}
                onChange={(e) => setSelection((s) => ({ ...s, [opt.id]: e.target.value }))}
                className="bmpl-input"
              >
                <option value="">Select {opt.name.toLowerCase()}…</option>
                {opt.values.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.value}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="qty" className="bmpl-label">
            Quantity
          </label>
          <input
            id="qty"
            type="number"
            min={1}
            max={10000}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(10000, Math.floor(Number(e.target.value) || 1))))}
            className="bmpl-input w-24"
          />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-belize-blue px-5 py-2.5 text-sm font-semibold text-white shadow-bmpl-sm transition hover:bg-belize-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy
            ? 'Adding…'
            : outOfStock
              ? 'Out of stock'
              : needsVariant
                ? 'Select options'
                : `Add to cart · ${money(effectivePrice)}`}
        </button>
      </div>

      {message && (
        <p
          role="status"
          className={`mt-3 text-sm font-medium ${message.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}
        >
          {message.text}
          {message.kind === 'ok' && (
            <>
              {' '}
              <a href="/cart" className="font-semibold text-belize-blue hover:underline">
                View cart →
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

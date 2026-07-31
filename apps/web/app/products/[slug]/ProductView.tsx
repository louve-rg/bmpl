'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Gallery, type GalleryImage } from './Gallery';
import { Badge } from '../../../components/ui';
import { cartApi, money, notifyCartChanged } from '../../../lib/cart';
import type { ApiError } from '../../../lib/api';

interface Availability {
  inStock: boolean;
  lowStock?: boolean;
  outOfStock: boolean;
  available: number | null;
  unlimited: boolean;
  allowBackorders: boolean;
}
interface Variant {
  id: string;
  sku: string | null;
  priceMinor: number | null;
  salePriceMinor: number | null;
  optionValueIds: string[];
  availability: Availability;
}
interface Option {
  id: string;
  name: string;
  values: Array<{ id: string; value: string }>;
}

export interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  description: string | null;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  category: { name: string; slug: string };
  vendor: { businessName: string; slug: string };
  weightGrams: number | null;
  dimensionsMm: { length: number | null; width: number | null; height: number | null };
  tags: string[];
  images: GalleryImage[];
  availability: Availability;
  options: Option[];
  variants: Variant[];
}

/** Effective per-unit stock cap for a selection: null = no cap (unlimited /
 *  backorders / untracked), otherwise the available units. */
function stockCap(a: Availability): number | null {
  if (a.unlimited || a.allowBackorders) return null;
  return a.available == null ? null : Math.max(0, a.available);
}

export function ProductView({ product }: { product: ProductDetail }) {
  const router = useRouter();
  const hasVariants = product.variants.length > 0;
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const selectedVariant = useMemo(() => {
    if (!hasVariants) return null;
    if (Object.keys(selection).length !== product.options.length) return null;
    const chosen = new Set(Object.values(selection));
    return (
      product.variants.find(
        (v) => v.optionValueIds.length === chosen.size && v.optionValueIds.every((id) => chosen.has(id)),
      ) ?? null
    );
  }, [hasVariants, selection, product.options.length, product.variants]);

  const needsVariant = hasVariants && !selectedVariant;
  const avail: Availability = selectedVariant ? selectedVariant.availability : product.availability;
  const outOfStock = selectedVariant ? selectedVariant.availability.outOfStock : !product.availability.inStock;
  const cap = needsVariant ? null : stockCap(avail);
  const maxQty = cap == null ? null : cap;

  // Keep the chosen quantity within the current cap (e.g. after switching variant).
  const effectiveQty = maxQty == null ? qty : Math.min(qty, Math.max(1, maxQty));

  const effectivePrice = selectedVariant
    ? selectedVariant.salePriceMinor ?? selectedVariant.priceMinor ?? product.salePriceMinor ?? product.priceMinor
    : product.salePriceMinor ?? product.priceMinor;
  const compareAt = selectedVariant
    ? selectedVariant.salePriceMinor != null
      ? selectedVariant.priceMinor ?? product.priceMinor
      : null
    : product.salePriceMinor != null
      ? product.priceMinor
      : null;

  // Variant-aware gallery: variant images → general images → all (graceful fallback).
  const galleryImages = useMemo(() => {
    const all = product.images;
    const general = all.filter((i) => i.variantId == null);
    const base = general.length ? general : all;
    if (!selectedVariant) return base;
    const forVariant = all.filter((i) => i.variantId === selectedVariant.id);
    return forVariant.length ? forVariant : base;
  }, [product.images, selectedVariant]);

  function clampQty(n: number) {
    const lo = 1;
    const hi = maxQty == null ? 100000 : Math.max(1, maxQty);
    setQty(Math.max(lo, Math.min(hi, Math.floor(n) || 1)));
  }

  async function add() {
    setBusy(true);
    setMessage(null);
    try {
      const cart = await cartApi.add({ productId: product.id, variantId: selectedVariant?.id ?? null, quantity: effectiveQty });
      notifyCartChanged(cart.itemCount);
      setMessage({ kind: 'ok', text: 'Added to your cart.' });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/products/${product.slug}`)}`);
        return;
      }
      setMessage({ kind: 'err', text: err.message || 'Could not add to cart.' });
    } finally {
      setBusy(false);
    }
  }

  const canAdd = !busy && !needsVariant && !outOfStock && (maxQty == null || maxQty >= 1);
  const dims = product.dimensionsMm;

  return (
    <div className="mt-4 grid gap-8 md:grid-cols-2">
      {/* key resets the active thumbnail when the shown image set changes */}
      <Gallery key={selectedVariant?.id ?? 'base'} images={galleryImages} />

      <div>
        <p className="bmpl-eyebrow">{product.category.name}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-belize-navy">{product.title}</h1>
        {product.brand && <p className="text-sm text-slate-500">by {product.brand}</p>}

        <p className="mt-4 text-2xl">
          {compareAt != null ? (
            <>
              <span className="font-bold text-belize-blue">{money(effectivePrice)}</span>{' '}
              <span className="text-lg text-slate-400 line-through">{money(compareAt)}</span>
            </>
          ) : (
            <span className="font-bold text-belize-navy">{money(effectivePrice)}</span>
          )}
          <span className="ml-2 text-sm text-slate-400">{product.currency}</span>
        </p>

        <p className="mt-2">
          <StockBadge outOfStock={outOfStock} avail={avail} needsVariant={needsVariant} />
        </p>

        {/* ---- buy panel ---- */}
        <div className="mt-6 rounded-bmpl-lg border border-slate-200 bg-white p-4 shadow-bmpl-sm">
          {hasVariants && (
            <div className="space-y-3">
              {product.options.map((opt) => (
                <div key={opt.id}>
                  <label htmlFor={`opt-${opt.id}`} className="bmpl-label">{opt.name}</label>
                  <select
                    id={`opt-${opt.id}`}
                    value={selection[opt.id] ?? ''}
                    onChange={(e) => { setSelection((s) => ({ ...s, [opt.id]: e.target.value })); setQty(1); }}
                    className="bmpl-input"
                  >
                    <option value="">Select {opt.name.toLowerCase()}…</option>
                    {opt.values.map((val) => (
                      <option key={val.id} value={val.id}>{val.value}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <span className="bmpl-label">Quantity</span>
              <div className="inline-flex items-stretch overflow-hidden rounded-bmpl-md border border-slate-300">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  disabled={outOfStock || needsVariant || effectiveQty <= 1}
                  onClick={() => clampQty(effectiveQty - 1)}
                  className="px-3 text-lg text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                >−</button>
                <input
                  aria-label="Quantity"
                  type="number"
                  min={1}
                  max={maxQty ?? undefined}
                  value={effectiveQty}
                  disabled={outOfStock || needsVariant}
                  onChange={(e) => clampQty(Number(e.target.value))}
                  className="w-14 border-x border-slate-300 text-center text-sm outline-none focus:ring-2 focus:ring-belize-accent/30 disabled:bg-slate-50"
                />
                <button
                  type="button"
                  aria-label="Increase quantity"
                  disabled={outOfStock || needsVariant || (maxQty != null && effectiveQty >= maxQty)}
                  onClick={() => clampQty(effectiveQty + 1)}
                  className="px-3 text-lg text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                >+</button>
              </div>
            </div>

            <button
              type="button"
              onClick={add}
              disabled={!canAdd}
              className="flex-1 rounded-bmpl-md bg-belize-blue px-5 py-2.5 text-sm font-semibold text-white shadow-bmpl-sm transition hover:bg-belize-deep disabled:cursor-not-allowed disabled:opacity-60"
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

          {!needsVariant && !outOfStock && maxQty != null && maxQty <= 10 && (
            <p className="mt-2 text-xs font-medium text-amber-600">
              Only {maxQty} left in stock — the quantity is capped at what's available.
            </p>
          )}

          {message && (
            <p role="status" className={`mt-3 text-sm ${message.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
              {message.text}
              {message.kind === 'ok' && (
                <>
                  {' '}
                  <a href="/cart" className="font-semibold text-belize-blue hover:underline">View cart →</a>
                </>
              )}
            </p>
          )}
        </div>

        <p className="mt-3 text-sm text-slate-500">
          Sold by{' '}
          <Link href={`/store/${product.vendor.slug}`} className="font-medium text-belize-blue hover:underline">
            {product.vendor.businessName}
          </Link>
        </p>

        {product.description && <p className="mt-5 whitespace-pre-wrap text-slate-600">{product.description}</p>}

        {(product.weightGrams || dims.length || dims.width || dims.height) && (
          <dl className="mt-6 grid grid-cols-2 gap-2 text-sm text-slate-600">
            {product.weightGrams && <div><dt className="text-slate-400">Weight</dt><dd>{product.weightGrams} g</dd></div>}
            {(dims.length || dims.width || dims.height) && (
              <div><dt className="text-slate-400">Dimensions</dt><dd>{dims.length ?? '—'}×{dims.width ?? '—'}×{dims.height ?? '—'} mm</dd></div>
            )}
          </dl>
        )}

        {product.tags.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {product.tags.map((t) => (
              <Badge key={t} tone="neutral">{t}</Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StockBadge({ outOfStock, avail, needsVariant }: { outOfStock: boolean; avail: Availability; needsVariant: boolean }) {
  if (needsVariant) return <Badge tone="neutral">Select options</Badge>;
  if (outOfStock) return <Badge tone="error">Out of stock</Badge>;
  const low = avail.lowStock || (avail.available != null && !avail.unlimited && avail.available <= 5);
  return <Badge tone={low ? 'warning' : 'success'}>{low ? 'Low stock' : 'In stock'}</Badge>;
}

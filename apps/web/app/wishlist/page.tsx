'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  Spinner,
} from '../../components/ui';
import {
  savedApi,
  money,
  notifySavedChanged,
  invalidateSaved,
  type SavedItem,
  type ViewedItem,
} from '../../lib/saved';
import { cartApi, notifyCartChanged } from '../../lib/cart';
import { variantDisplay, secondaryLine } from '../../lib/variant-display';
import type { ApiError } from '../../lib/api';

type LoadState = 'loading' | 'ready' | 'guest' | 'error';

export default function WishlistPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [viewed, setViewed] = useState<ViewedItem[]>([]);
  const [viewedLoaded, setViewedLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await savedApi.list();
      setItems(res.items);
      notifySavedChanged(res.items.length);
      setState('ready');
    } catch (e) {
      if ((e as ApiError).status === 401) setState('guest');
      else setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-dismiss the toast so it doesn't linger.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Recently viewed loads independently; hidden entirely on empty/guest/error.
  useEffect(() => {
    if (state !== 'ready') return;
    let active = true;
    savedApi
      .recentlyViewed()
      .then((r) => {
        if (!active) return;
        setViewed(r.items.filter((i) => i.available && i.product));
        setViewedLoaded(true);
      })
      .catch(() => active && setViewedLoaded(true));
    return () => {
      active = false;
    };
  }, [state]);

  async function remove(item: SavedItem) {
    setBusyId(item.id);
    const prev = items;
    const next = items.filter((i) => i.id !== item.id);
    setItems(next); // optimistic
    notifySavedChanged(next.length);
    try {
      await savedApi.unsave(item.productId, item.variantId);
      invalidateSaved();
      notifySavedChanged(next.length);
    } catch (e) {
      if ((e as ApiError).status === 401) {
        setState('guest');
        return;
      }
      setItems(prev); // rollback
      notifySavedChanged(prev.length);
    } finally {
      setBusyId(null);
    }
  }

  async function addToCart(item: SavedItem) {
    setBusyId(item.id);
    try {
      // Add the EXACT saved selection — no re-picking options.
      const cart = await cartApi.add({ productId: item.productId, variantId: item.variantId, quantity: 1 });
      notifyCartChanged(cart.itemCount);
      setToast({ kind: 'ok', text: 'Added to your cart.' });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        setState('guest');
        return;
      }
      setToast({ kind: 'err', text: err.message || 'Could not add to cart.' });
    } finally {
      setBusyId(null);
    }
  }

  async function clearRecentlyViewed() {
    const prev = viewed;
    setViewed([]);
    try {
      await savedApi.clearRecentlyViewed();
    } catch {
      setViewed(prev); // rollback
    }
  }

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <PageHeader title="Wishlist" description="Items you've saved to buy later." />

        {toast && (
          <p
            role="status"
            className={`mt-4 rounded-bmpl-md px-4 py-2 text-sm font-medium ${
              toast.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {toast.text}
            {toast.kind === 'ok' && (
              <>
                {' '}
                <Link href="/cart" className="font-semibold text-belize-blue hover:underline">
                  View cart →
                </Link>
              </>
            )}
          </p>
        )}

        {state === 'loading' && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-14 text-center">
            <Spinner />
            <p className="text-sm text-slate-400">Loading your Wishlist…</p>
          </div>
        )}

        {state === 'error' && (
          <Alert tone="error" title="We couldn't load your Wishlist." className="mt-8">
            <p>Please try again in a moment.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => {
                setState('loading');
                void load();
              }}
            >
              Retry
            </Button>
          </Alert>
        )}

        {state === 'guest' && (
          <div className="mt-8">
            <EmptyState
              title="Sign in to see your Wishlist"
              description="Your Wishlist is tied to your account so you can pick up where you left off on any device."
              action={<ButtonLink href="/login?next=/wishlist">Sign in</ButtonLink>}
            />
          </div>
        )}

        {state === 'ready' && items.length === 0 && (
          <div className="mt-8">
            <EmptyState
              title="Your Wishlist is empty"
              description="Tap the heart on any product to add it to your Wishlist for later."
              action={<ButtonLink href="/products">Browse the marketplace</ButtonLink>}
            />
          </div>
        )}

        {state === 'ready' && items.length > 0 && (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <WishlistCard
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onRemove={() => remove(item)}
                onAddToCart={() => addToCart(item)}
              />
            ))}
          </div>
        )}

        {state === 'ready' && viewedLoaded && viewed.length > 0 && (
          <section className="mt-14">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-belize-navy">Recently viewed</h2>
              <button
                type="button"
                onClick={clearRecentlyViewed}
                className="text-sm font-medium text-slate-500 transition hover:text-red-600"
              >
                Clear
              </button>
            </div>
            <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
              {viewed.map((v) => (
                <MiniCard key={v.productId} item={v} />
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}

/** Derived presentation for one Wishlist entry — variant fields take precedence. */
function present(item: SavedItem) {
  const p = item.product;
  const v = item.variant;
  const imageUrl = v?.imageUrl ?? p?.primaryImageUrl ?? null;
  // Shared hierarchy: variant name (primary) → remaining option values → base product family.
  const disp = variantDisplay({
    displayName: v?.displayName ?? null,
    optionValues: v?.optionValues ?? [],
    title: v?.title ?? null,
    productTitle: p?.title ?? null,
  });
  const title = disp.primary || p?.title || 'Product';
  const priceMinor = v ? v.priceMinor ?? p?.priceMinor ?? 0 : p?.priceMinor ?? 0;
  const salePriceMinor = v ? v.salePriceMinor : p?.salePriceMinor ?? null;
  // Unavailable = the product/variant is no longer viewable; OOS = present but not buyable.
  const unavailable = !item.available || !p;
  const outOfStock = v ? v.availability?.outOfStock === true : p ? !p.inStock : true;
  const lowStock = v?.availability?.lowStock === true;
  return {
    p,
    v,
    imageUrl,
    title,
    secondary: disp.secondary,
    family: disp.family,
    priceMinor,
    salePriceMinor,
    unavailable,
    outOfStock,
    lowStock,
  };
}

function WishlistCard({
  item,
  busy,
  onRemove,
  onAddToCart,
}: {
  item: SavedItem;
  busy: boolean;
  onRemove: () => void;
  onAddToCart: () => void;
}) {
  const m = present(item);

  // Unavailable / delisted product (or a variant that's gone): greyed card, remove only.
  if (m.unavailable) {
    return (
      <div className="flex flex-col rounded-bmpl-lg border border-slate-200 bg-white p-4 opacity-70 shadow-bmpl-sm">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-bmpl-lg bg-slate-100 text-sm text-slate-400">
          {m.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.imageUrl} alt={m.title} className="h-full w-full object-cover grayscale" />
          ) : (
            'No image'
          )}
        </div>
        <p className="mt-3 font-semibold text-belize-navy">{m.title}</p>
        {m.secondary.length > 0 && <p className="text-xs text-slate-500">{secondaryLine(m.secondary)}</p>}
        {m.family && <p className="text-xs text-slate-400">{m.family}</p>}
        <Badge tone="neutral" className="mt-1.5 self-start">Unavailable</Badge>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="mt-3 inline-flex min-h-[40px] items-center self-start text-xs font-medium text-slate-500 transition hover:text-red-600 disabled:opacity-40"
        >
          Remove from Wishlist
        </button>
      </div>
    );
  }

  const p = m.p!;

  return (
    <div className="flex flex-col rounded-bmpl-lg border border-slate-200 bg-white p-4 shadow-bmpl-sm transition hover:border-belize-light/60 hover:shadow-bmpl-md">
      <Link href={`/products/${p.slug}`} className="group block">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-bmpl-lg bg-slate-100 text-sm text-slate-400">
          {m.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.imageUrl} alt={m.title} className="h-full w-full object-cover" />
          ) : (
            'No image'
          )}
        </div>
        {/* Variant name is the primary line; never replaced by the parent title. */}
        <p className="mt-3 font-semibold text-belize-navy group-hover:text-belize-blue">{m.title}</p>
      </Link>
      {m.secondary.length > 0 && <p className="text-xs text-slate-500">{secondaryLine(m.secondary)}</p>}
      {m.family && <p className="text-xs text-slate-400">{m.family}</p>}

      <p className="mt-0.5 text-xs text-slate-400">
        <Link href={`/store/${p.vendor.slug}`} className="hover:text-belize-blue hover:underline">
          {p.vendor.businessName}
        </Link>
      </p>

      {item.variant?.sku && <p className="mt-0.5 text-xs text-slate-400">SKU: {item.variant.sku}</p>}

      <p className="mt-1.5 text-sm">
        {m.salePriceMinor != null ? (
          <>
            <span className="font-bold text-belize-blue">{money(m.salePriceMinor)}</span>{' '}
            <span className="text-slate-400 line-through">{money(m.priceMinor)}</span>
          </>
        ) : (
          <span className="font-bold text-belize-navy">{money(m.priceMinor)}</span>
        )}
      </p>

      <div className="mt-1.5">
        {m.outOfStock ? (
          <Badge tone="error">Out of stock</Badge>
        ) : (
          <Badge tone={m.lowStock ? 'warning' : 'success'}>{m.lowStock ? 'Low stock' : 'In stock'}</Badge>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          onClick={onAddToCart}
          disabled={busy || m.outOfStock}
          title={m.outOfStock ? 'This item is out of stock.' : undefined}
        >
          Add to cart
        </Button>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="inline-flex min-h-[40px] items-center text-xs font-medium text-slate-500 transition hover:text-red-600 disabled:opacity-40"
        >
          Remove from Wishlist
        </button>
      </div>
    </div>
  );
}

function MiniCard({ item }: { item: ViewedItem }) {
  const p = item.product;
  if (!p) return null;
  return (
    <Link
      href={`/products/${p.slug}`}
      className="group w-40 shrink-0 snap-start rounded-bmpl-lg border border-slate-200 bg-white p-3 shadow-bmpl-sm transition hover:border-belize-light/60 hover:shadow-bmpl-md"
    >
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-bmpl-md bg-slate-100 text-xs text-slate-400">
        {p.primaryImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.primaryImageUrl} alt={p.title} className="h-full w-full object-cover" />
        ) : (
          'No image'
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-medium text-belize-navy group-hover:text-belize-blue">{p.title}</p>
      <p className="mt-0.5 text-sm font-bold text-belize-navy">
        {p.salePriceMinor != null ? (
          <>
            <span className="text-belize-blue">{money(p.salePriceMinor)}</span>{' '}
            <span className="text-xs font-normal text-slate-400 line-through">{money(p.priceMinor)}</span>
          </>
        ) : (
          money(p.priceMinor)
        )}
      </p>
    </Link>
  );
}

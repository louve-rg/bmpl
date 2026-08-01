'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { StarRating } from '../../components/reviews/StarRating';
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
  invalidateSavedIds,
  type SavedItem,
  type ViewedItem,
} from '../../lib/saved';
import type { ApiError } from '../../lib/api';

type LoadState = 'loading' | 'ready' | 'guest' | 'error';

export default function WishlistPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function remove(productId: string) {
    setBusyId(productId);
    const prev = items;
    const next = items.filter((i) => i.productId !== productId);
    setItems(next); // optimistic
    notifySavedChanged(next.length);
    try {
      await savedApi.unsave(productId);
      invalidateSavedIds();
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
        <PageHeader title="Saved products" description="Products you've bookmarked to buy later." />

        {state === 'loading' && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-14 text-center">
            <Spinner />
            <p className="text-sm text-slate-400">Loading your saved products…</p>
          </div>
        )}

        {state === 'error' && (
          <Alert tone="error" title="We couldn't load your saved products." className="mt-8">
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
              title="Sign in to see your saved products"
              description="Your wishlist is tied to your account so you can pick up where you left off on any device."
              action={<ButtonLink href="/login?next=/wishlist">Sign in</ButtonLink>}
            />
          </div>
        )}

        {state === 'ready' && items.length === 0 && (
          <div className="mt-8">
            <EmptyState
              title="No saved products yet"
              description="Tap the heart on any product to save it here for later."
              action={<ButtonLink href="/products">Browse the marketplace</ButtonLink>}
            />
          </div>
        )}

        {state === 'ready' && items.length > 0 && (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <SavedCard
                key={item.productId}
                item={item}
                busy={busyId === item.productId}
                onRemove={() => remove(item.productId)}
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

function SavedCard({
  item,
  busy,
  onRemove,
}: {
  item: SavedItem;
  busy: boolean;
  onRemove: () => void;
}) {
  const p = item.product;

  // Unavailable / delisted product: greyed card with remove only.
  if (!item.available || !p) {
    return (
      <div className="flex flex-col rounded-bmpl-lg border border-slate-200 bg-white p-4 opacity-70 shadow-bmpl-sm">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-bmpl-lg bg-slate-100 text-sm text-slate-400">
          {p?.primaryImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.primaryImageUrl} alt={p.title ?? ''} className="h-full w-full object-cover grayscale" />
          ) : (
            'No image'
          )}
        </div>
        <p className="mt-3 font-semibold text-belize-navy">{p?.title ?? 'Product'}</p>
        <Badge tone="neutral" className="mt-1.5 self-start">No longer available</Badge>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="mt-3 self-start text-xs font-medium text-slate-500 transition hover:text-red-600 disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-bmpl-lg border border-slate-200 bg-white p-4 shadow-bmpl-sm transition hover:border-belize-light/60 hover:shadow-bmpl-md">
      <Link href={`/products/${p.slug}`} className="group block">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-bmpl-lg bg-slate-100 text-sm text-slate-400">
          {p.primaryImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.primaryImageUrl} alt={p.title} className="h-full w-full object-cover" />
          ) : (
            'No image'
          )}
        </div>
        <p className="mt-3 font-semibold text-belize-navy group-hover:text-belize-blue">{p.title}</p>
      </Link>
      <p className="text-xs text-slate-400">{p.vendor.businessName} · {p.category.name}</p>

      {p.ratingCount > 0 && (
        <div className="mt-1.5">
          <StarRating value={p.ratingAverage} size="sm" count={p.ratingCount} />
        </div>
      )}

      <p className="mt-1.5 text-sm">
        {p.salePriceMinor != null ? (
          <>
            <span className="font-bold text-belize-blue">{money(p.salePriceMinor)}</span>{' '}
            <span className="text-slate-400 line-through">{money(p.priceMinor)}</span>
          </>
        ) : (
          <span className="font-bold text-belize-navy">{money(p.priceMinor)}</span>
        )}
      </p>

      <div className="mt-1.5">
        <Badge tone={p.inStock ? 'success' : 'error'}>{p.inStock ? 'In stock' : 'Out of stock'}</Badge>
      </div>

      <div className="mt-3 flex items-center gap-3">
        {p.inStock ? (
          <ButtonLink href={`/products/${p.slug}`} size="sm">Add to cart</ButtonLink>
        ) : (
          <ButtonLink href={`/products/${p.slug}`} size="sm" variant="outline">View product</ButtonLink>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="text-xs font-medium text-slate-500 transition hover:text-red-600 disabled:opacity-40"
        >
          Remove
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

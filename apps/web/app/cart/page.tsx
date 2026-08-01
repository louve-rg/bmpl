'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import {
  cartApi,
  ISSUE_LABELS,
  money,
  notifyCartChanged,
  type CartLine,
  type CartView,
} from '../../lib/cart';
import type { ApiError } from '../../lib/api';
import { Alert, Button, ButtonLink, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await cartApi.get();
      setCart(c);
      notifyCartChanged(c.itemCount);
      setState('ready');
    } catch (e) {
      if ((e as ApiError).status === 401) {
        router.push(`/login?next=${encodeURIComponent('/cart')}`);
        return;
      }
      setState('error');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(fn: () => Promise<CartView>, itemId?: string) {
    if (itemId) setBusyItem(itemId);
    try {
      const c = await fn();
      setCart(c);
      notifyCartChanged(c.itemCount);
    } catch (e) {
      if ((e as ApiError).status === 401) router.push(`/login?next=${encodeURIComponent('/cart')}`);
      else void load(); // refetch to reflect the true server state on any conflict
    } finally {
      setBusyItem(null);
    }
  }

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <PageHeader title="Your cart" />

        {state === 'loading' && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-14 text-center">
            <Spinner />
            <p className="text-sm text-slate-400">Loading your cart…</p>
          </div>
        )}

        {state === 'error' && (
          <Alert tone="error" title="We couldn’t load your cart." className="mt-8">
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

        {state === 'ready' && cart && cart.vendors.length === 0 && (
          <div className="mt-8">
            <EmptyState
              title="Your cart is empty"
              description="Browse the marketplace and add something you like."
              action={<ButtonLink href="/products">Start shopping</ButtonLink>}
            />
          </div>
        )}

        {state === 'ready' && cart && cart.vendors.length > 0 && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              {cart.hasUnavailableItems && (
                <Alert tone="warning">
                  Some items are unavailable and won’t be included in your subtotal. Remove or update them to continue.
                </Alert>
              )}
              {cart.hasPriceChanges && (
                <Alert tone="info">Some prices changed since you added them. The current price is shown.</Alert>
              )}

              {cart.vendors.map((v) => (
                <Card key={v.vendorProfileId} className="overflow-hidden">
                  <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <Link href={`/store/${v.slug}`} className="font-semibold text-belize-navy hover:text-belize-blue">
                      {v.businessName}
                    </Link>
                    <span className="text-sm text-slate-500">{money(v.subtotalMinor)}</span>
                  </header>
                  <ul className="divide-y divide-slate-100">
                    {v.items.map((item) => (
                      <CartRow
                        key={item.id}
                        item={item}
                        busy={busyItem === item.id}
                        onUpdate={(q) => mutate(() => cartApi.update(item.id, q), item.id)}
                        onRemove={() => mutate(() => cartApi.remove(item.id), item.id)}
                      />
                    ))}
                  </ul>
                </Card>
              ))}

              <button
                onClick={() => mutate(() => cartApi.clear())}
                className="text-sm font-medium text-slate-500 hover:text-red-600"
              >
                Clear cart
              </button>
            </div>

            <aside className="h-fit lg:sticky lg:top-24">
              <Card className="p-5">
                <h2 className="text-lg font-semibold text-belize-navy">Summary</h2>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Items</dt>
                    <dd className="font-medium text-slate-700">{cart.itemCount}</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-2">
                    <dt className="text-slate-500">Subtotal</dt>
                    <dd className="text-base font-bold text-belize-navy">
                      {money(cart.subtotalMinor)} {cart.currency}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-slate-400">Taxes, delivery, and fees are calculated at checkout.</p>
                {cart.hasUnavailableItems ? (
                  <Button disabled title="Resolve the unavailable items before checking out." className="mt-4 w-full">
                    Resolve items to checkout
                  </Button>
                ) : (
                  <ButtonLink href="/checkout" className="mt-4 w-full">
                    Proceed to checkout
                  </ButtonLink>
                )}
                <Link href="/products" className="mt-3 block text-center text-sm text-belize-blue hover:underline">
                  Continue shopping
                </Link>
              </Card>
            </aside>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function CartRow({
  item,
  busy,
  onUpdate,
  onRemove,
}: {
  item: CartLine;
  busy: boolean;
  onUpdate: (quantity: number) => void;
  onRemove: () => void;
}) {
  const blocking = item.issues.filter((i) => i !== 'INSUFFICIENT_STOCK');
  return (
    <li className={`flex gap-4 p-4 ${item.purchasable ? '' : 'opacity-70'}`}>
      <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-bmpl-md bg-slate-100 text-xs text-slate-300">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          'No image'
        )}
      </div>

      <div className="min-w-0 flex-1">
        <Link href={`/products/${item.slug}`} className="font-medium text-belize-navy hover:text-belize-blue">
          {item.variantTitle ?? item.title}
        </Link>
        {item.variantTitle && item.variantTitle !== item.title && (
          <p className="text-xs text-slate-500">{item.title}</p>
        )}
        {item.variantLabel && <p className="text-xs text-slate-400">{item.variantLabel}</p>}
        <p className="mt-1 text-sm">
          <span className="font-semibold text-belize-navy">{money(item.unitPriceMinor)}</span>
          {item.priceChanged && (
            <span className="ml-2 text-xs text-slate-400 line-through">{money(item.unitPriceMinorSnapshot)}</span>
          )}
          {item.priceChanged && <span className="ml-1 text-xs font-medium text-belize-blue">price updated</span>}
        </p>

        {/* Availability warnings */}
        {blocking.length > 0 && (
          <p className="mt-1 text-xs font-semibold text-red-600">
            {blocking.map((i) => ISSUE_LABELS[i]).join(' · ')}
          </p>
        )}
        {item.issues.includes('INSUFFICIENT_STOCK') && item.available != null && (
          <p className="mt-1 text-xs font-semibold text-amber-600">
            Only {item.available} available — reduce the quantity.
          </p>
        )}

        <div className="mt-2 flex items-center gap-3">
          <div className="inline-flex items-center rounded-bmpl-sm border border-slate-300">
            <button
              type="button"
              aria-label="Decrease quantity"
              disabled={busy || item.quantity <= 1}
              onClick={() => onUpdate(item.quantity - 1)}
              className="px-2.5 py-1 text-slate-600 disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-8 px-2 text-center text-sm" aria-live="polite">
              {item.quantity}
            </span>
            <button
              type="button"
              aria-label="Increase quantity"
              disabled={busy || (item.available != null && item.quantity >= item.available)}
              onClick={() => onUpdate(item.quantity + 1)}
              className="px-2.5 py-1 text-slate-600 disabled:opacity-40"
              title={item.available != null && item.quantity >= item.available ? `Only ${item.available} in stock` : undefined}
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="text-right text-sm font-semibold text-belize-navy">{money(item.lineSubtotalMinor)}</div>
    </li>
  );
}

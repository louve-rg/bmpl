'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { cartApi, money, type CartLine, type CartView } from '../../lib/cart';
import { variantDisplay } from '../../lib/variant-display';
import { DISTRICTS, type OrderView } from '../../lib/orders';
import dynamic from 'next/dynamic';
import type { Coordinates } from '@bmpl/shared';
import { api, type ApiError } from '../../lib/api';

/**
 * Browser-only: Leaflet touches `window` at import time, and the map is
 * meaningless server-rendered. Loading it dynamically also keeps Leaflet and its
 * CSS out of every bundle except this route's.
 */
const LocationPicker = dynamic(
  () => import('../../components/maps/LocationPicker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full animate-pulse rounded-bmpl-md border border-slate-200 bg-slate-100" aria-hidden />
    ),
  },
);
import { Alert, Button, Card, EmptyState, ButtonLink, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';

type Method = 'PICKUP' | 'DELIVERY';

interface QuoteVendor {
  vendorProfileId: string;
  businessName: string;
  deliveryMethod: Method;
  deliverable: boolean;
  reason: string | null;
  feeMinor: number;
  freeApplied: boolean;
  estimate: { minHours: number; maxHours: number; label: string | null } | null;
  minimumOrderMinor: number | null;
}
interface QuoteResponse {
  district: string;
  vendors: QuoteVendor[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
}

/**
 * A checkout line item in a clean STACKED layout: Product, each selected option on its
 * own labeled line, Cost (unit price), and Quantity. Works for any number of variant
 * options and never repeats the product name as an option. Presentation-only — the
 * cart figures (unit price, line total, quantity) are unchanged.
 */
function CheckoutItem({ it }: { it: CartLine }) {
  const disp = variantDisplay({
    displayName: it.displayName ?? null,
    optionValues: it.optionValues ?? [],
    title: it.variantTitle ?? null,
    productTitle: it.title,
  });
  const pairs =
    it.options && it.options.length
      ? it.options.filter((o) => o.value.toLowerCase() !== disp.primary.toLowerCase())
      : disp.secondary.map((value) => ({ name: 'Option', value }));

  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <dt className="text-xs uppercase tracking-wide text-slate-400">Product</dt>
        <dd className="font-medium text-belize-navy">{disp.primary || it.title}</dd>
        {pairs.map((o, i) => (
          <Fragment key={`${o.name}-${i}`}>
            <dt className="text-xs uppercase tracking-wide text-slate-400">{o.name}</dt>
            <dd className="text-slate-700">{o.value}</dd>
          </Fragment>
        ))}
        <dt className="text-xs uppercase tracking-wide text-slate-400">Cost</dt>
        <dd className="text-slate-700">
          {money(it.unitPriceMinor)} <span className="text-slate-400">BZD</span>
        </dd>
        <dt className="text-xs uppercase tracking-wide text-slate-400">Quantity</dt>
        <dd className="text-slate-700">×{it.quantity}</dd>
      </dl>
      <span className="shrink-0 text-right font-semibold text-belize-navy">{money(it.lineSubtotalMinor)}</span>
    </li>
  );
}

const estText = (e: { minHours: number; maxHours: number; label: string | null } | null): string | null => {
  if (!e) return null;
  if (e.label) return e.label;
  const fmt = (h: number) => (h % 24 === 0 ? `${h / 24}d` : `${h}h`);
  return e.minHours === e.maxHours ? fmt(e.minHours) : `${fmt(e.minHours)}–${fmt(e.maxHours)}`;
};

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [methods, setMethods] = useState<Record<string, Method>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [address, setAddress] = useState({ fullName: '', phone: '', addressLine1: '', addressLine2: '', city: '', district: 'BELIZE' });
  // The customer's map pin. Held separately from `address` so a delivery-quote
  // refresh (which re-runs on district/method changes) can never drop it.
  const [pin, setPin] = useState<Coordinates | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await cartApi.get();
      setCart(c);
      setMethods(Object.fromEntries(c.vendors.map((v) => [v.vendorProfileId, 'PICKUP' as Method])));
      setState('ready');
    } catch (e) {
      if ((e as ApiError).status === 401) router.push(`/login?next=${encodeURIComponent('/checkout')}`);
      else setState('error');
    }
  }, [router]);
  useEffect(() => {
    void load();
  }, [load]);

  const anyDelivery = cart ? cart.vendors.some((v) => methods[v.vendorProfileId] === 'DELIVERY') : false;

  // Live delivery quote: refreshes as fulfilment choices or destination district change.
  useEffect(() => {
    if (!cart || !anyDelivery || !address.district) {
      setQuote(null);
      return;
    }
    let active = true;
    const vendors = cart.vendors.map((v) => ({ vendorProfileId: v.vendorProfileId, deliveryMethod: methods[v.vendorProfileId] ?? 'PICKUP' }));
    api
      .post<QuoteResponse>('/checkout/delivery-quote', { district: address.district, vendors })
      .then((q) => active && setQuote(q))
      .catch(() => active && setQuote(null));
    return () => {
      active = false;
    };
  }, [cart, anyDelivery, address.district, methods]);

  const quoteByVendor = new Map((quote?.vendors ?? []).map((q) => [q.vendorProfileId, q]));
  const deliveryFeeMinor = anyDelivery ? quote?.deliveryFeeMinor ?? null : 0;
  const totalMinor = cart ? (deliveryFeeMinor != null ? cart.subtotalMinor + deliveryFeeMinor : null) : null;
  const undeliverable = (quote?.vendors ?? []).filter((q) => q.deliveryMethod === 'DELIVERY' && !q.deliverable);

  async function placeOrder() {
    if (!cart) return;
    setError(null);
    if (anyDelivery && (!address.fullName.trim() || !address.addressLine1.trim() || !address.city.trim())) {
      setError('Please complete the delivery address.');
      return;
    }
    setPlacing(true);
    const body = {
      vendors: cart.vendors.map((v) => ({
        vendorProfileId: v.vendorProfileId,
        deliveryMethod: methods[v.vendorProfileId] ?? ('PICKUP' as Method),
        customerNotes: notes[v.vendorProfileId]?.trim() || undefined,
        deliveryInstructions: methods[v.vendorProfileId] === 'DELIVERY' ? instructions[v.vendorProfileId]?.trim() || undefined : undefined,
      })),
      deliveryAddress: anyDelivery
        ? {
            fullName: address.fullName.trim(),
            phone: address.phone.trim() || undefined,
            addressLine1: address.addressLine1.trim(),
            addressLine2: address.addressLine2.trim() || undefined,
            city: address.city.trim(),
            district: address.district,
            // Optional. The server re-validates the bounds — this is convenience,
            // not trust.
            latitude: pin?.latitude,
            longitude: pin?.longitude,
          }
        : undefined,
    };
    try {
      const order = await api.post<OrderView>('/checkout', body);
      router.push(`/orders/${order.id}?placed=1`);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) router.push(`/login?next=${encodeURIComponent('/checkout')}`);
      else {
        setError(err.message || 'Checkout failed. Please review your cart and try again.');
        setPlacing(false);
      }
    }
  }

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <PageHeader title="Checkout" />

        {state === 'loading' && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-14 text-center">
            <Spinner />
            <p className="text-sm text-slate-400">Loading…</p>
          </div>
        )}
        {state === 'error' && (
          <Alert tone="error" title="We couldn’t load your cart." className="mt-8">
            <button onClick={() => { setState('loading'); void load(); }} className="font-semibold underline">
              Retry
            </button>
          </Alert>
        )}

        {state === 'ready' && cart && cart.vendors.length === 0 && (
          <div className="mt-8">
            <EmptyState
              title="Your cart is empty"
              description="Add something to your cart before checking out."
              action={<ButtonLink href="/products">Start shopping</ButtonLink>}
            />
          </div>
        )}

        {state === 'ready' && cart && cart.vendors.length > 0 && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              {cart.hasUnavailableItems && (
                <Alert tone="error">
                  Some items are unavailable. <Link href="/cart" className="font-semibold underline">Edit your cart</Link> before checking out.
                </Alert>
              )}

              {cart.vendors.map((v) => {
                const method = methods[v.vendorProfileId] ?? 'PICKUP';
                const q = quoteByVendor.get(v.vendorProfileId);
                return (
                  <Card key={v.vendorProfileId} className="p-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <span className="font-semibold text-belize-navy">{v.businessName}</span>
                      <span className="text-sm text-slate-500">{money(v.subtotalMinor)}</span>
                    </div>
                    <ul className="divide-y divide-slate-100 text-sm">
                      {v.items.map((it) => (
                        <CheckoutItem key={it.id} it={it} />
                      ))}
                    </ul>
                    <fieldset className="mt-3">
                      <legend className="bmpl-label">Fulfilment</legend>
                      <div className="mt-1 flex gap-4 text-sm">
                        {(['PICKUP', 'DELIVERY'] as Method[]).map((m) => (
                          <label key={m} className="flex items-center gap-1.5 text-slate-700">
                            <input
                              type="radio"
                              name={`method-${v.vendorProfileId}`}
                              checked={method === m}
                              onChange={() => setMethods((s) => ({ ...s, [v.vendorProfileId]: m }))}
                              className="accent-belize-blue"
                            />
                            {m === 'PICKUP' ? 'Pickup' : 'Delivery'}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {/* Live per-vendor delivery outcome */}
                    {method === 'DELIVERY' && q && (
                      q.deliverable ? (
                        <p className="mt-2 text-xs font-medium text-slate-500">
                          Delivery: <span className="text-belize-navy">{q.freeApplied ? 'Free' : money(q.feeMinor)}</span>
                          {estText(q.estimate) ? ` · Est. ${estText(q.estimate)}` : ''}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs font-semibold text-amber-600">
                          {q.reason === 'PICKUP_ONLY'
                            ? 'This store does not offer delivery — choose Pickup.'
                            : q.reason === 'BELOW_MINIMUM'
                              ? `Below this store's delivery minimum${q.minimumOrderMinor != null ? ` (${money(q.minimumOrderMinor)})` : ''}.`
                              : `This store does not deliver to ${address.district.replace('_', ' ')}.`}
                        </p>
                      )
                    )}

                    <Input
                      value={notes[v.vendorProfileId] ?? ''}
                      onChange={(e) => setNotes((s) => ({ ...s, [v.vendorProfileId]: e.target.value }))}
                      placeholder="Notes for this store (optional)"
                      maxLength={1000}
                      aria-label={`Notes for ${v.businessName}`}
                      className="mt-3"
                    />
                    {method === 'DELIVERY' && (
                      <Input
                        value={instructions[v.vendorProfileId] ?? ''}
                        onChange={(e) => setInstructions((s) => ({ ...s, [v.vendorProfileId]: e.target.value }))}
                        placeholder="Delivery instructions (optional)"
                        maxLength={1000}
                        aria-label={`Delivery instructions for ${v.businessName}`}
                        className="mt-2"
                      />
                    )}
                  </Card>
                );
              })}

              {anyDelivery && (
                <Card className="p-4">
                  <h2 className="mb-3 font-semibold text-belize-navy">Delivery address &amp; contact</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Full name">
                      <Input placeholder="Full name" value={address.fullName} onChange={(e) => setAddress({ ...address, fullName: e.target.value })} />
                    </Field>
                    <Field label="Contact number">
                      <Input placeholder="Phone" value={address.phone} onChange={(e) => setAddress({ ...address, phone: e.target.value })} />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Address line 1">
                        <Input placeholder="Address line 1" value={address.addressLine1} onChange={(e) => setAddress({ ...address, addressLine1: e.target.value })} />
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Field label="Address line 2">
                        <Input placeholder="Address line 2 (optional)" value={address.addressLine2} onChange={(e) => setAddress({ ...address, addressLine2: e.target.value })} />
                      </Field>
                    </div>
                    <Field label="City / town">
                      <Input placeholder="City / town" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} />
                    </Field>
                    <Field label="District">
                      <Select value={address.district} onChange={(e) => setAddress({ ...address, district: e.target.value })}>
                        {DISTRICTS.map((d) => (
                          <option key={d} value={d}>{d.replace('_', ' ')}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  {/* Written address + exact pin, together. The address gives the
                      driver human context ("Ladyville"), the pin gives them a
                      navigable point. Neither replaces the other. */}
                  <div className="mt-4">
                    <LocationPicker
                      value={pin}
                      onChange={setPin}
                      disabled={placing}
                      address={[address.addressLine1, address.addressLine2, address.city].filter(Boolean).join(', ')}
                      district={address.district}
                    />
                  </div>
                </Card>
              )}
            </div>

            <aside className="h-fit lg:sticky lg:top-24">
              <Card className="p-5">
                <h2 className="text-lg font-semibold text-belize-navy">Order summary</h2>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Items</dt><dd className="font-medium">{cart.itemCount}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="font-medium text-belize-navy">{money(cart.subtotalMinor)}</dd></div>
                  {anyDelivery && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Delivery</dt>
                      <dd className="font-medium text-belize-navy">
                        {deliveryFeeMinor == null ? '…' : deliveryFeeMinor === 0 ? 'Free' : money(deliveryFeeMinor)}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-100 pt-2">
                    <dt className="text-slate-500">Total</dt>
                    <dd className="text-base font-bold text-belize-navy">
                      {totalMinor == null ? money(cart.subtotalMinor) : money(totalMinor)} {cart.currency}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-slate-400">Taxes and fees are not yet calculated.</p>

                {undeliverable.length > 0 && (
                  <Alert tone="warning" className="mt-3">
                    Some stores can’t deliver to {address.district.replace('_', ' ')}. Switch them to Pickup or change the address.
                  </Alert>
                )}
                {error && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}

                <Button
                  type="button"
                  onClick={placeOrder}
                  disabled={placing || cart.hasUnavailableItems || undeliverable.length > 0}
                  className="mt-4 w-full"
                >
                  {placing ? 'Placing order…' : 'Place order'}
                </Button>

                {/* Payment is a later milestone — button intentionally disabled. */}
                <Button type="button" variant="outline" disabled title="Payment integration coming next." className="mt-2 w-full">
                  Pay now
                </Button>
                <p className="mt-1 text-center text-xs text-slate-400">Payment integration coming next.</p>

                <Link href="/cart" className="mt-3 block text-center text-sm text-belize-blue hover:underline">Back to cart</Link>
              </Card>
            </aside>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

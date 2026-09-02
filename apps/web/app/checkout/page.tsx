'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { cartApi, money, type CartLine, type CartView } from '../../lib/cart';
import { variantDisplay } from '../../lib/variant-display';
import { type OrderView } from '../../lib/orders';
import {
  AddressField,
  addressGap,
  emptyAddress,
  type AddressValue,
} from '../../components/address/AddressField';
import { api, type ApiError } from '../../lib/api';
import { affordability, bzd, walletApi, type WalletSummary } from '../../lib/wallet';
import { Alert, Button, Card, EmptyState, ButtonLink, Input, PageHeader, Spinner } from '../../components/ui';

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
  /**
   * ONE address value, in the same shape Shipping already uses.
   *
   * This page used to keep its own hand-rolled address form: no way to choose
   * HOW you give the address, the street fields always on screen, and a submit
   * guard that demanded a street line even from a customer who had dropped a pin
   * on their own doorstep. Shipping had already grown the right component; the
   * marketplace simply never adopted it, so the two halves of one product asked
   * for a delivery address in two different ways and only one of them worked.
   *
   * The pin lives INSIDE the value rather than beside it. Held separately it was
   * one careless setAddress away from being silently dropped.
   */
  const [address, setAddress] = useState<AddressValue>(() => ({ ...emptyAddress('TYPED'), district: 'BELIZE' }));
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

  // The balance is fetched alongside the cart so the customer learns they cannot
  // afford this BEFORE they commit, rather than from a cancelled order after.
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  useEffect(() => {
    walletApi.summary().then(setWallet).catch(() => setWallet(null));
  }, []);
  const canAfford = affordability(totalMinor ?? cart?.subtotalMinor ?? 0, wallet);
  const undeliverable = (quote?.vendors ?? []).filter((q) => q.deliveryMethod === 'DELIVERY' && !q.deliverable);

  async function placeOrder(payWithWallet: boolean) {
    if (!cart) return;
    setError(null);
    /**
     * Say what is actually missing.
     *
     * The old guard demanded a street line unconditionally and then reported
     * 'Please complete the delivery address.' — wrong for a pinned address
     * (nothing was incomplete) and useless for every other case (it never said
     * what to fix). addressGap applies the SAME rule the server does and
     * finishes the sentence.
     */
    const gap = anyDelivery ? addressGap(address, { contact: 'ESSENTIAL' }) : null;
    if (gap) {
      setError(gap);
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
            // Omitted, not empty, when the customer pinned the location instead
            // of typing it. An empty string would be stored as an address nobody
            // wrote, and a driver would read it as one.
            addressLine1: address.addressLine1.trim() || undefined,
            addressLine2: address.addressLine2.trim() || undefined,
            city: address.city.trim(),
            district: address.district,
            // Optional. The server re-validates the bounds — this is convenience,
            // not trust.
            latitude: address.latitude ?? undefined,
            longitude: address.longitude ?? undefined,
          }
        : undefined,
    };
    try {
      const order = await api.post<OrderView>('/checkout', { ...body, payWithWallet });
      router.push(`/orders/${order.id}?placed=1`);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) router.push(`/login?next=${encodeURIComponent('/checkout')}`);
      else {
        setError(err.message || 'Checkout failed. Please review your cart and try again.');
        setPlacing(false);
        // A payment refusal is worth re-reading the balance for: it may have
        // changed under another tab, and the customer is about to be told what
        // they can do about it.
        if (payWithWallet) walletApi.summary().then(setWallet).catch(() => {});
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
                <AddressField
                  heading="Delivery address & contact"
                  description="Where the driver is taking it, and who to ask for."
                  value={address}
                  onChange={setAddress}
                  disabled={placing}
                  /* An order stores a name and a phone and nothing else, so the
                     email and company boxes Shipping shows would be filled in
                     here and then silently thrown away. */
                  contact="ESSENTIAL"
                  /* Instructions are collected per store above: two vendors in
                     one order are two separate drops to two different drivers. */
                  showInstructions={false}
                />
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

                {/* What the wallet holds, next to what the order costs. Two
                    numbers a customer can compare at a glance. */}
                {wallet && (
                  <div className="mt-4 flex items-baseline justify-between rounded-bmpl-md bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-500">Wallet available</span>
                    <span className="font-semibold tabular-nums text-belize-navy">{bzd(wallet.availableMinor)}</span>
                  </div>
                )}

                {canAfford.known && !canAfford.sufficient && (
                  <Alert tone="warning" className="mt-3">
                    {canAfford.message}
                    <Link href="/wallet" className="mt-1 block font-semibold text-belize-blue hover:underline">
                      Add money to your wallet
                    </Link>
                  </Alert>
                )}

                {/* Paying is the primary action now that the wallet is live. */}
                <Button
                  type="button"
                  onClick={() => placeOrder(true)}
                  disabled={
                    placing ||
                    cart.hasUnavailableItems ||
                    undeliverable.length > 0 ||
                    (canAfford.known && !canAfford.sufficient)
                  }
                  className="mt-4 min-h-[48px] w-full"
                >
                  {placing ? 'Paying…' : `Pay ${totalMinor == null ? money(cart.subtotalMinor) : money(totalMinor)} with wallet`}
                </Button>

                {/* Placing without paying still exists — a vendor may agree to
                    settle another way — but it is no longer the default. */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => placeOrder(false)}
                  disabled={placing || cart.hasUnavailableItems || undeliverable.length > 0}
                  className="mt-2 min-h-[44px] w-full"
                >
                  Place order without paying now
                </Button>

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

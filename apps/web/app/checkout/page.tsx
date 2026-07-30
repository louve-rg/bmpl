'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { cartApi, money, type CartView } from '../../lib/cart';
import { ordersApi, DISTRICTS, type CheckoutBody } from '../../lib/orders';
import type { ApiError } from '../../lib/api';

type Method = 'PICKUP' | 'DELIVERY';

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [methods, setMethods] = useState<Record<string, Method>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [address, setAddress] = useState({ fullName: '', phone: '', addressLine1: '', addressLine2: '', city: '', district: 'BELIZE' });
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

  async function placeOrder() {
    if (!cart) return;
    setError(null);
    if (anyDelivery && (!address.fullName.trim() || !address.addressLine1.trim() || !address.city.trim())) {
      setError('Please complete the delivery address.');
      return;
    }
    setPlacing(true);
    const body: CheckoutBody = {
      vendors: cart.vendors.map((v) => ({
        vendorProfileId: v.vendorProfileId,
        deliveryMethod: methods[v.vendorProfileId] ?? 'PICKUP',
        customerNotes: notes[v.vendorProfileId]?.trim() || undefined,
      })),
      deliveryAddress: anyDelivery
        ? {
            fullName: address.fullName.trim(),
            phone: address.phone.trim() || undefined,
            addressLine1: address.addressLine1.trim(),
            addressLine2: address.addressLine2.trim() || undefined,
            city: address.city.trim(),
            district: address.district,
          }
        : undefined,
    };
    try {
      const order = await ordersApi.checkout(body);
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
        <h1 className="text-3xl font-bold text-belize-navy">Checkout</h1>

        {state === 'loading' && <p className="mt-8 text-center text-slate-400">Loading…</p>}
        {state === 'error' && (
          <p className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-700">
            We couldn’t load your cart. <button onClick={() => { setState('loading'); void load(); }} className="font-semibold underline">Retry</button>
          </p>
        )}

        {state === 'ready' && cart && cart.vendors.length === 0 && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-12 text-center">
            <p className="text-slate-500">Your cart is empty.</p>
            <Link href="/products" className="mt-4 inline-block rounded-lg bg-belize-blue px-5 py-2.5 text-sm font-semibold text-white">Start shopping</Link>
          </div>
        )}

        {state === 'ready' && cart && cart.vendors.length > 0 && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              {cart.hasUnavailableItems && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                  Some items are unavailable. <Link href="/cart" className="font-semibold underline">Edit your cart</Link> before checking out.
                </p>
              )}

              {cart.vendors.map((v) => (
                <section key={v.vendorProfileId} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <span className="font-semibold text-belize-navy">{v.businessName}</span>
                    <span className="text-sm text-slate-500">{money(v.subtotalMinor)}</span>
                  </div>
                  <ul className="divide-y divide-slate-100 text-sm">
                    {v.items.map((it) => (
                      <li key={it.id} className="flex justify-between py-2">
                        <span className="text-slate-600">
                          {it.title}
                          {it.variantLabel ? ` · ${it.variantLabel}` : ''} × {it.quantity}
                        </span>
                        <span className="text-slate-700">{money(it.lineSubtotalMinor)}</span>
                      </li>
                    ))}
                  </ul>
                  <fieldset className="mt-3">
                    <legend className="text-xs font-semibold uppercase text-slate-500">Fulfilment</legend>
                    <div className="mt-1 flex gap-4 text-sm">
                      {(['PICKUP', 'DELIVERY'] as Method[]).map((m) => (
                        <label key={m} className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name={`method-${v.vendorProfileId}`}
                            checked={(methods[v.vendorProfileId] ?? 'PICKUP') === m}
                            onChange={() => setMethods((s) => ({ ...s, [v.vendorProfileId]: m }))}
                          />
                          {m === 'PICKUP' ? 'Pickup' : 'Delivery'}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <input
                    value={notes[v.vendorProfileId] ?? ''}
                    onChange={(e) => setNotes((s) => ({ ...s, [v.vendorProfileId]: e.target.value }))}
                    placeholder="Notes for this store (optional)"
                    maxLength={1000}
                    aria-label={`Notes for ${v.businessName}`}
                    className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </section>
              ))}

              {anyDelivery && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h2 className="mb-3 font-semibold text-belize-navy">Delivery address</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input aria-label="Full name" placeholder="Full name" value={address.fullName} onChange={(e) => setAddress({ ...address, fullName: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input aria-label="Phone" placeholder="Phone (optional)" value={address.phone} onChange={(e) => setAddress({ ...address, phone: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <input aria-label="Address line 1" placeholder="Address line 1" value={address.addressLine1} onChange={(e) => setAddress({ ...address, addressLine1: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                    <input aria-label="Address line 2" placeholder="Address line 2 (optional)" value={address.addressLine2} onChange={(e) => setAddress({ ...address, addressLine2: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                    <input aria-label="City / town" placeholder="City / town" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <select aria-label="District" value={address.district} onChange={(e) => setAddress({ ...address, district: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                      {DISTRICTS.map((d) => (
                        <option key={d} value={d}>{d.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                </section>
              )}
            </div>

            <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 lg:sticky lg:top-24">
              <h2 className="text-lg font-semibold text-belize-navy">Order summary</h2>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Items</dt><dd className="font-medium">{cart.itemCount}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Storefronts</dt><dd className="font-medium">{cart.vendors.length}</dd></div>
                <div className="flex justify-between border-t border-slate-100 pt-2"><dt className="text-slate-500">Subtotal</dt><dd className="font-semibold text-belize-navy">{money(cart.subtotalMinor)} {cart.currency}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-slate-400">Taxes, delivery, and fees are not yet calculated.</p>

              {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

              <button
                type="button"
                onClick={placeOrder}
                disabled={placing || cart.hasUnavailableItems}
                className="mt-4 w-full rounded-lg bg-belize-blue px-5 py-3 text-sm font-semibold text-white hover:bg-belize-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {placing ? 'Placing order…' : 'Place order'}
              </button>

              {/* Payment is a later milestone — button intentionally disabled. */}
              <button type="button" disabled title="Payment integration coming next." className="mt-2 w-full cursor-not-allowed rounded-lg bg-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-500">
                Pay now
              </button>
              <p className="mt-1 text-center text-xs text-slate-400">Payment integration coming next.</p>

              <Link href="/cart" className="mt-3 block text-center text-sm text-belize-blue hover:underline">Back to cart</Link>
            </aside>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

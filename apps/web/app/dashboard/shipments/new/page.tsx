'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  needsFirstMile,
  needsLastMile,
  SHIPPING_SERVICE_LABELS,
  TRANSPORT_MODE_LABELS,
  type ShippingService,
  type TransportMode,
} from '@bmpl/shared';
import { formatTransitTime, shippingApi, shippingMoney, type ShipmentQuote, type ShippingHub } from '../../../../lib/shipping';
import { EndpointPicker, emptyEndpoint, type EndpointValue } from '../../../../components/shipping/EndpointPicker';
import { ServiceTypeField } from '../../../../components/shipping/ServiceTypeField';
import { Alert, Button, PageHeader, Spinner } from '../../../../components/ui';
import type { ApiError } from '../../../../lib/api';
import { bzd, walletApi, type WalletSummary } from '../../../../lib/wallet';

/**
 * Booking a shipment.
 *
 * One page, top to bottom, rather than a wizard. The whole thing fits in a
 * single scroll on a phone, and a wizard would hide the quote — the number the
 * customer actually cares about — behind a "next" button while they are still
 * deciding whether to send the parcel at all.
 *
 * The quote is asked for as the form becomes answerable and re-asked whenever
 * anything that could change it changes, so the price is never stale relative to
 * what is on screen. Booking then re-quotes server-side; this page never
 * computes money.
 */

type Mode = TransportMode | 'ANY';

/**
 * Enough filled in to be worth asking the server for a price.
 *
 * A door end needs its TOWN, not just its district. The planner compares towns
 * to decide whether one courier can do the whole job — Belize City and San
 * Pedro are both the Belize District and one of them is on an island — so a
 * district-only enquiry cannot be priced correctly. Asking anyway produced a
 * quote for a journey nobody had described yet, and the customer read the
 * resulting "there is no terminal serving Belize District" as the site being
 * broken rather than as the form being half-filled.
 */
function quotable(service: ShippingService, origin: EndpointValue, destination: EndpointValue): boolean {
  const originOk = needsFirstMile(service) ? !!origin.district && !!origin.city.trim() : !!origin.hubId;
  const destOk = needsLastMile(service) ? !!destination.district && !!destination.city.trim() : !!destination.hubId;
  return originOk && destOk;
}

/** The request body both quoting and booking use, so they cannot disagree. */
function toRequest(service: ShippingService, mode: Mode, origin: EndpointValue, destination: EndpointValue, parcel: { description: string; pieces: string }) {
  const end = (v: EndpointValue, door: boolean) =>
    door
      ? {
          name: v.name || undefined,
          phone: v.phone || undefined,
          email: v.email || undefined,
          company: v.company || undefined,
          address: v.address || undefined,
          address2: v.addressLine2 || undefined,
          city: v.city || undefined,
          district: v.district || undefined,
          instructions: v.instructions || undefined,
          latitude: v.latitude ?? undefined,
          longitude: v.longitude ?? undefined,
        }
      : { hubId: v.hubId, name: v.name || undefined, phone: v.phone || undefined, instructions: v.instructions || undefined };
  return {
    service,
    origin: end(origin, needsFirstMile(service)),
    destination: end(destination, needsLastMile(service)),
    preferredMode: mode === 'ANY' ? undefined : mode,
    description: parcel.description || undefined,
    pieces: Number(parcel.pieces) || 1,
  };
}

export default function NewShipmentPage() {
  const router = useRouter();

  const [hubs, setHubs] = useState<ShippingHub[]>([]);
  const [modes, setModes] = useState<TransportMode[]>([]);
  const [service, setService] = useState<ShippingService>('DOOR_TO_DOOR');
  const [mode, setMode] = useState<Mode>('ANY');
  const [origin, setOrigin] = useState<EndpointValue>(emptyEndpoint());
  const [destination, setDestination] = useState<EndpointValue>(emptyEndpoint());
  const [parcel, setParcel] = useState({ description: '', pieces: '1' });

  const [quote, setQuote] = useState<ShipmentQuote | null>(null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);

  useEffect(() => {
    walletApi.summary().then(setWallet).catch(() => setWallet(null));
  }, []);
  const [quoting, setQuoting] = useState(false);
  const [booking, setBooking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    shippingApi.hubs().then(setHubs).catch(() => setHubs([]));
    // Only offer ways of travelling the network can actually provide. Offering
    // "Flight" with no flight configured produces a quote that always fails and
    // a customer who concludes the site is broken.
    shippingApi.modes().then(setModes).catch(() => setModes([]));
  }, []);

  // The service type decides which end is a door and which is a terminal, so
  // keep each endpoint's own mode in step rather than letting them contradict it.
  useEffect(() => {
    setOrigin((o) => ({ ...o, mode: needsFirstMile(service) ? 'DOOR' : 'HUB' }));
    setDestination((d) => ({ ...d, mode: needsLastMile(service) ? 'DOOR' : 'HUB' }));
  }, [service]);

  useEffect(() => {
    if (mode !== 'ANY' && modes.length > 0 && !modes.includes(mode)) setMode('ANY');
  }, [mode, modes]);

  const request = useMemo(
    () => toRequest(service, mode, origin, destination, parcel),
    [service, mode, origin, destination, parcel],
  );
  const ready = quotable(service, origin, destination);

  const refreshQuote = useCallback(async () => {
    if (!ready) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    try {
      setQuote(await shippingApi.quote(request));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'We could not price that route just now.');
      setQuote(null);
    } finally {
      setQuoting(false);
    }
  }, [ready, request]);

  // Debounced: the district and hub selects fire as fast as a customer can click
  // through them, and each one would otherwise be a round trip.
  useEffect(() => {
    const t = setTimeout(() => void refreshQuote(), 400);
    return () => clearTimeout(t);
  }, [refreshQuote]);

  async function book() {
    setBooking(true);
    setErr(null);
    try {
      const created = await shippingApi.create({ ...request, payWithWallet: true });
      router.push(`/dashboard/shipments/${encodeURIComponent(created.reference)}`);
    } catch (e) {
      const api = e as ApiError;
      setErr(api.errors?.[0]?.message ?? api.message ?? 'We could not book that shipment.');
      setBooking(false);
    }
  }

  // Only a priced quote has a total to compare against; an unavailable one is
  // blocked for its own reason further up.
  const priced = quote?.available === true ? quote : null;
  const affordable = wallet == null || priced == null || wallet.availableMinor >= priced.totalMinor;
  const canBook = priced != null && !priced.pricingIncomplete && !booking && affordable;

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <PageHeader title="Ship a package" description="Send a parcel anywhere in Belize — by road, air or boat." />

      {/* 1. What kind of service. Chosen first because it decides which fields
             the rest of the form even shows. */}
      <div className="mt-6 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
        <ServiceTypeField value={service} onChange={setService} />
      </div>

      <div className="mt-4 space-y-4">
        <EndpointPicker
          label="Collect from"
          contactLabel="Sender"
          value={origin}
          onChange={setOrigin}
          hubs={hubs}
          allowDoor={needsFirstMile(service)}
          allowHub={!needsFirstMile(service)}
        />
        <EndpointPicker
          label="Deliver to"
          contactLabel="Recipient"
          value={destination}
          onChange={setDestination}
          hubs={hubs}
          allowDoor={needsLastMile(service)}
          allowHub={!needsLastMile(service)}
        />
      </div>

      <fieldset className="mt-4 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
        <legend className="px-1 text-sm font-semibold text-belize-navy">How should it travel?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['ANY', ...modes] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`min-h-[44px] rounded-full border px-4 text-sm font-medium transition ${
                mode === m ? 'border-belize-blue bg-belize-blue text-white' : 'border-slate-300 text-slate-700 hover:border-slate-400'
              }`}
            >
              {m === 'ANY' ? 'Best available' : TRANSPORT_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {/* Honest about what this is: a preference the network may not be able to
            honour, not a promise. The quote below says which. */}
        {/* With no routes configured we can still carry a parcel across one
            district by road — that journey has no terminal in it. Saying "we
            cannot price a journey" would be wrong for exactly the trip most
            customers are trying to book. */}
        <p className="mt-2 text-xs text-slate-500">
          {modes.length === 0
            ? 'Long-distance transport between terminals is not running yet. Deliveries within one district still go by road.'
            : 'We will use the cheapest service that can actually make the trip. Choosing a mode restricts it to that mode.'}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">What is in it?</span>
            <input
              value={parcel.description}
              onChange={(e) => setParcel((p) => ({ ...p, description: e.target.value }))}
              placeholder="One box of documents"
              className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Pieces</span>
            <input
              value={parcel.pieces}
              onChange={(e) => setParcel((p) => ({ ...p, pieces: e.target.value }))}
              inputMode="numeric"
              className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
            />
          </label>
        </div>
      </fieldset>

      {/* 2. The quote. One price, and the journey that produced it. */}
      <div className="mt-4">
        {!ready && (
          <p className="rounded-bmpl-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            Tell us the town at each end and we will price the whole journey.
          </p>
        )}

        {ready && quoting && !quote && (
          <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Working out your route…
          </div>
        )}

        {quote && !quote.available && (
          <Alert tone="warning">
            {/* The planner's own words, which are already customer-facing. */}
            {quote.message}
            {quote.useLocalDelivery && (
              <span className="mt-1 block">
                For a delivery inside one town, order through the marketplace and choose delivery at checkout.
              </span>
            )}
          </Alert>
        )}

        {quote?.available && (
          <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">{quote.serviceLabel}</p>
                <p className="mt-0.5 text-sm text-slate-600">{quote.serviceDescription}</p>
              </div>
              <p className="text-2xl font-bold tabular-nums text-belize-navy">{shippingMoney(quote.totalMinor)}</p>
            </div>

            <ol className="mt-4 space-y-2">
              {quote.legs.map((leg) => (
                <li key={leg.sequence} className="flex gap-3 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                    {leg.sequence}
                  </span>
                  <span className="min-w-0 break-words text-slate-700">{leg.description}</span>
                </li>
              ))}
            </ol>

            {formatTransitTime(quote.transportMinutes) && (
              <p className="mt-3 text-sm text-slate-500">
                Estimated transit: about {formatTransitTime(quote.transportMinutes)}. This is travel time, not a
                scheduled arrival.
              </p>
            )}

            {quote.pricingIncomplete && (
              <Alert tone="warning" className="mt-3">
                {quote.pricingNote} We cannot take this booking until that is set — please contact us.
              </Alert>
            )}
          </div>
        )}
      </div>

      {/* 3. Review and pay. The customer should know money is about to move, how
             much, and what they will have left — before they commit. */}
      {quote?.available && !quote.pricingIncomplete && (
        <div className="mt-4 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
          <h2 className="text-sm font-semibold text-belize-navy">Review and pay</h2>

          <dl className="mt-3 space-y-1.5 text-sm">
            <Line label="Service" value={quote.serviceLabel} />
            <Line label="From" value={[origin.city, origin.district.replace(/_/g, ' ')].filter(Boolean).join(', ') || '—'} />
            <Line label="To" value={[destination.city, destination.district.replace(/_/g, ' ')].filter(Boolean).join(', ') || '—'} />
            <Line label="Parcel" value={`${parcel.pieces || 1} × ${parcel.description || 'parcel'}`} />
            <Line label="Transport" value={mode === 'ANY' ? 'Best available' : TRANSPORT_MODE_LABELS[mode as TransportMode]} />
          </dl>

          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-belize-navy">Total</span>
              <span className="text-xl font-bold tabular-nums text-belize-navy">{shippingMoney(quote.totalMinor)}</span>
            </div>
          </div>

          <div className="mt-3 rounded-bmpl-md bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paying with</p>
            <p className="mt-0.5 text-sm font-semibold text-belize-navy">BML Wallet</p>
            {wallet && (
              <dl className="mt-2 space-y-1 text-sm">
                <Line label="Available now" value={bzd(wallet.availableMinor)} />
                <Line label="To be charged" value={shippingMoney(quote.totalMinor)} />
                <Line
                  label="Left afterwards"
                  value={bzd(Math.max(0, wallet.availableMinor - quote.totalMinor))}
                />
              </dl>
            )}
            {wallet && wallet.availableMinor < quote.totalMinor && (
              <Alert tone="warning" className="mt-3">
                <span className="font-semibold">Insufficient wallet balance.</span> This shipment costs{' '}
                {shippingMoney(quote.totalMinor)}, your available balance is {bzd(wallet.availableMinor)}, so you are{' '}
                {bzd(quote.totalMinor - wallet.availableMinor)} short.
              </Alert>
            )}
          </div>
        </div>
      )}

      {err && (
        <Alert tone="warning" className="mt-4">
          {err}
        </Alert>
      )}

      {/* 3. Book. Pinned so the price and the button are reachable with a thumb
             without scrolling back down a long form. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-3 backdrop-blur sm:static sm:mt-4 sm:border-0 sm:bg-transparent sm:p-0">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {quote?.available && (
            <span className="shrink-0 text-lg font-bold tabular-nums text-belize-navy sm:hidden">
              {shippingMoney(quote.totalMinor)}
            </span>
          )}
          {/* Never "Book" — booking now takes the money, and the button should
              say so before it is pressed. */}
          <Button onClick={book} disabled={!canBook} className="min-h-[48px] w-full text-base">
            {booking
              ? 'Paying…'
              : quote?.available
                ? `Pay ${shippingMoney(quote.totalMinor)} & book shipment`
                : 'Pay & book shipment'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One label/value row in the review panel. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}

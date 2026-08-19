'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  needsFirstMile,
  needsLastMile,
  SHIPPING_SERVICES,
  SHIPPING_SERVICE_DESCRIPTIONS,
  SHIPPING_SERVICE_LABELS,
  TRANSPORT_MODES,
  TRANSPORT_MODE_LABELS,
  type ShippingService,
  type TransportMode,
} from '@bmpl/shared';
import { formatTransitTime, shippingApi, shippingMoney, type ShipmentQuote, type ShippingHub } from '../../../../lib/shipping';
import { EndpointPicker, emptyEndpoint, type EndpointValue } from '../../../../components/shipping/EndpointPicker';
import { Alert, Button, PageHeader, Spinner } from '../../../../components/ui';
import type { ApiError } from '../../../../lib/api';

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

/** Enough filled in to be worth asking the server for a price. */
function quotable(service: ShippingService, origin: EndpointValue, destination: EndpointValue): boolean {
  const originOk = needsFirstMile(service) ? !!origin.district : !!origin.hubId;
  const destOk = needsLastMile(service) ? !!destination.district : !!destination.hubId;
  return originOk && destOk;
}

/** The request body both quoting and booking use, so they cannot disagree. */
function toRequest(service: ShippingService, mode: Mode, origin: EndpointValue, destination: EndpointValue, parcel: { description: string; pieces: string }) {
  const end = (v: EndpointValue, door: boolean) =>
    door
      ? {
          name: v.name || undefined,
          phone: v.phone || undefined,
          address: v.address || undefined,
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
  const [service, setService] = useState<ShippingService>('DOOR_TO_DOOR');
  const [mode, setMode] = useState<Mode>('ANY');
  const [origin, setOrigin] = useState<EndpointValue>(emptyEndpoint());
  const [destination, setDestination] = useState<EndpointValue>(emptyEndpoint());
  const [parcel, setParcel] = useState({ description: '', pieces: '1' });

  const [quote, setQuote] = useState<ShipmentQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [booking, setBooking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    shippingApi.hubs().then(setHubs).catch(() => setHubs([]));
  }, []);

  // The service type decides which end is a door and which is a terminal, so
  // keep each endpoint's own mode in step rather than letting them contradict it.
  useEffect(() => {
    setOrigin((o) => ({ ...o, mode: needsFirstMile(service) ? 'DOOR' : 'HUB' }));
    setDestination((d) => ({ ...d, mode: needsLastMile(service) ? 'DOOR' : 'HUB' }));
  }, [service]);

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
      const created = await shippingApi.create(request);
      router.push(`/dashboard/shipments/${encodeURIComponent(created.reference)}`);
    } catch (e) {
      const api = e as ApiError;
      setErr(api.errors?.[0]?.message ?? api.message ?? 'We could not book that shipment.');
      setBooking(false);
    }
  }

  const canBook = quote?.available === true && !quote.pricingIncomplete && !booking;

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <PageHeader title="Ship a package" description="Send a parcel anywhere in Belize — by road, air or boat." />

      {/* 1. What kind of service. Chosen first because it decides what the rest
             of the form asks for. */}
      <fieldset className="mt-6 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
        <legend className="px-1 text-sm font-semibold text-belize-navy">How far should we take it?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SHIPPING_SERVICES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setService(s)}
              aria-pressed={service === s}
              className={`min-h-[72px] rounded-bmpl-md border p-3 text-left transition ${
                service === s ? 'border-belize-blue bg-belize-blue/5 ring-1 ring-belize-blue' : 'border-slate-300 hover:border-slate-400'
              }`}
            >
              <span className="block text-sm font-semibold text-belize-navy">{SHIPPING_SERVICE_LABELS[s]}</span>
              <span className="mt-0.5 block text-xs leading-snug text-slate-500">{SHIPPING_SERVICE_DESCRIPTIONS[s]}</span>
            </button>
          ))}
        </div>
      </fieldset>

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
          {(['ANY', ...TRANSPORT_MODES] as Mode[]).map((m) => (
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
        <p className="mt-2 text-xs text-slate-500">
          We will use the cheapest service that can actually make the trip. Choosing a mode restricts it to that mode.
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
            Tell us where it is going and we will price the whole journey.
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
          <Button onClick={book} disabled={!canBook} className="min-h-[48px] w-full text-base">
            {booking ? 'Booking…' : 'Book this shipment'}
          </Button>
        </div>
      </div>
    </div>
  );
}

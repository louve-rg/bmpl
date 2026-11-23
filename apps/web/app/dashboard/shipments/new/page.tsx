'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  belizeCalendarDateKey,
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
import { Alert, Button, FormCard, PageHeader, Spinner, StickyActionBar } from '../../../../components/ui';
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

/**
 * Same door, not just the same town — two different addresses in Belize City
 * are not this case. A HUB endpoint has no address text to compare, so two
 * HUB ends are "the same" only when they are literally the same hub.
 *
 * Not a validator: someone shipping between two units at one address, or one
 * hub back to itself, is a real booking. This only decides whether to ask
 * "are you sure?" before paying — see the confirm in `book()` below.
 */
function sameEndpoint(a: EndpointValue, b: EndpointValue): boolean {
  if (a.mode === 'HUB' || b.mode === 'HUB') return a.mode === b.mode && !!a.hubId && a.hubId === b.hubId;
  const norm = (s: string) => s.trim().toLowerCase();
  return !!norm(a.address) && norm(a.address) === norm(b.address) && norm(a.city) === norm(b.city) && a.district === b.district;
}

/** Today, Belize calendar — the default travel date and the picker's floor. */
function todayKey(): string {
  return belizeCalendarDateKey(new Date());
}

/**
 * Only `request()` in lib/api throws this shape, and only once it has a real
 * HTTP response to read (`status` is always a number there). A dropped
 * connection or an aborted request never reaches that point — `fetch` itself
 * rejects with a plain `TypeError`/`DOMException`, which has no `status`.
 * That distinction is exactly what decides which message a customer reads
 * below: a server-told reason, or an honest "we don't know what happened."
 */
function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number';
}

/**
 * Shown when the booking request never got a usable response — connection
 * dropped, timed out, or the browser aborted it. We do not know whether the
 * server already charged the wallet and booked the shipment, so we never
 * guess and never resubmit automatically: silence is what makes a customer
 * retry and risk paying twice, so this says exactly that, in words, instead.
 */
const CONNECTION_LOST_MESSAGE =
  'We lost the connection before we could confirm this booking. Please do not submit again — check My Shipments to see whether it already went through, or contact us if you are not sure.';

/**
 * The exact numbers of a wallet shortfall, shared by the review panel's own
 * Alert and the sticky bar below (MDF-559) so the two can never state the
 * figures differently -- only the bold lead-in sentence differs between them.
 */
function shortfallSentence(totalMinor: number, availableMinor: number): string {
  return `This shipment costs ${shippingMoney(totalMinor)}, your available balance is ${bzd(availableMinor)}, so you are ${bzd(totalMinor - availableMinor)} short.`;
}

/**
 * WEB-BOOKING-NO-IDEMPOTENCY-KEY (Case 3, god 2026-11-23): `attemptKey` alone
 * is a `useRef` -- it lives in React memory only, so a page reload mid-submit
 * wipes it, the next attempt mints a FRESH key, and the server books (and
 * charges) a second time underneath the reload. `sessionStorage` is the one
 * piece of client storage that survives a reload but still dies with the tab
 * -- `localStorage` would outlive the booking entirely and could resurrect a
 * key days later.
 *
 * The stored entry carries the key TOGETHER WITH this fingerprint of the
 * `request` it was minted for, so restoring it on mount can reuse the exact
 * same invalidation rule the in-memory `useEffect` on `request` already
 * applies across a render: a reload only replays the key if the booking it
 * belongs to is still the one on screen. `JSON.stringify` is sufficient as
 * the fingerprint -- `toRequest()` below always builds the object the same
 * way, so two calls with the same inputs serialize identically.
 */
const ATTEMPT_STORAGE_KEY = 'bmpl:shipment-booking-attempt';

function fingerprint(request: unknown): string {
  return JSON.stringify(request);
}

/**
 * Every read/write is wrapped by the caller in try/catch, never here --
 * private browsing, blocked site data and a quota error all throw on
 * `sessionStorage` itself, and a booking form must still work with storage
 * dead (degrading to the current in-memory-only behaviour, i.e. Case 2 still
 * fixed, Case 3 not). These two are thin enough not to need their own
 * try/catch; call sites decide what "degrade" means for them.
 */
function readStoredAttempt(): { key: string; fingerprint: string } | null {
  const raw = sessionStorage.getItem(ATTEMPT_STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { key?: unknown; fingerprint?: unknown };
  return typeof parsed.key === 'string' && typeof parsed.fingerprint === 'string'
    ? { key: parsed.key, fingerprint: parsed.fingerprint }
    : null;
}

/** The request body both quoting and booking use, so they cannot disagree. */
function toRequest(
  service: ShippingService,
  mode: Mode,
  origin: EndpointValue,
  destination: EndpointValue,
  parcel: { description: string; pieces: string },
  travelDate: string,
) {
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
      : {
          hubId: v.hubId,
          name: v.name || undefined,
          phone: v.phone || undefined,
          // MDF-746: the recipient's email, same shape as the door-end
          // email just above -- optional, so a sender who does not know it
          // can still book. Without it the #695 "collection ready" mail for
          // this parcel has no address to send to.
          email: v.email || undefined,
          instructions: v.instructions || undefined,
        };
  return {
    service,
    origin: end(origin, needsFirstMile(service)),
    destination: end(destination, needsLastMile(service)),
    preferredMode: mode === 'ANY' ? undefined : mode,
    description: parcel.description || undefined,
    pieces: Number(parcel.pieces) || 1,
    // Always sent, never omitted: an empty picker already shows today, so
    // sending it explicitly changes nothing the API would otherwise default
    // to — it just makes what the quote priced against visible end to end.
    requestedDate: travelDate,
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
  const [travelDate, setTravelDate] = useState<string>(todayKey);

  const [quote, setQuote] = useState<ShipmentQuote | null>(null);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);

  useEffect(() => {
    walletApi.summary().then(setWallet).catch(() => setWallet(null));
  }, []);
  const [quoting, setQuoting] = useState(false);
  const [booking, setBooking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Mirrors `booking`, but read/set synchronously inside book() itself —
  // the `disabled` attribute only takes effect once React commits the next
  // render, which is not guaranteed to happen before a second click event
  // (a fast double-click, or two taps) reaches this same handler. The ref
  // closes that gap completely instead of relying on render timing.
  const submitInFlight = useRef(false);
  // WEB-BOOKING-NO-IDEMPOTENCY-KEY: one key per booking ATTEMPT, not per
  // click and not per page. "Attempt" means "this quoted request, however
  // many times the customer has to try it" -- generated lazily the first
  // time book() actually calls the API, and deliberately NOT cleared when a
  // call fails, so a resubmit after "we lost the connection, please do not
  // submit again" (the one thing a customer does anyway) reuses the SAME
  // key: the API replays the original shipment instead of booking a second
  // one. Reset below whenever `request` changes -- a materially different
  // booking (a different route, parcel, or date) must never share a key
  // with whatever was attempted before it, or a genuine second booking
  // would silently 409 instead of succeeding. Mirrored into sessionStorage
  // alongside a fingerprint of `request` (see ATTEMPT_STORAGE_KEY above) so
  // a page reload mid-submit restores the SAME key instead of minting a new
  // one -- a bare useRef does not survive that (Case 3).
  const attemptKey = useRef<string | null>(null);

  useEffect(() => {
    // Signed-in picker (TERM-SIM-NETWORK-INVISIBLE): scoped to the caller's
    // own side, so a test account can see a test hub to pick -- `hubs()`/
    // `modes()` are the anonymous, real-only pair and stay reserved for a
    // public marketing/compare surface, not this authenticated booking flow.
    shippingApi.hubsMine().then(setHubs).catch(() => setHubs([]));
    // Only offer ways of travelling the network can actually provide. Offering
    // "Flight" with no flight configured produces a quote that always fails and
    // a customer who concludes the site is broken.
    shippingApi.modesMine().then(setModes).catch(() => setModes([]));
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
    () => toRequest(service, mode, origin, destination, parcel, travelDate),
    [service, mode, origin, destination, parcel, travelDate],
  );
  // A new `request` is a new booking by definition (see attemptKey above) --
  // whatever attempt key existed for the PREVIOUS request must not leak into
  // this one. Also runs on mount (effects always do), which is what lets a
  // post-reload remount restore a key: if sessionStorage holds one whose
  // stored fingerprint still matches the CURRENT request, reuse it; anything
  // else (no entry, a mismatched fingerprint, or storage throwing at all) is
  // treated as "no attempt in flight" and falls back to today's in-memory-only
  // behaviour, same as before this change.
  //
  // A mismatch is never deleted here, only skipped -- this effect also fires
  // on every INTERMEDIATE render while a form is being refilled (e.g. one
  // endpoint filled, the other still blank), and those partial shapes are not
  // the request the stored entry belongs to either. Deleting on every one of
  // those transient mismatches would destroy a just-reloaded entry before the
  // form ever finishes being refilled back to the shape it matches. There is
  // only ever one stored entry (one fixed storage key): `book()` overwrites
  // it the moment a real new attempt is made, and clears it outright on
  // success, so a stale mismatch left sitting here is harmless.
  useEffect(() => {
    let restored: string | null = null;
    try {
      const stored = readStoredAttempt();
      if (stored && stored.fingerprint === fingerprint(request)) {
        restored = stored.key;
      }
    } catch {
      // Private mode, blocked site data, etc. -- no persisted key to restore.
    }
    attemptKey.current = restored;
  }, [request]);
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
    if (submitInFlight.current) return;
    // A confirmation, not a block -- someone shipping between two units at
    // one address, or a hub leg back to itself, is a real booking. This only
    // catches the case nobody meant: picking the same door twice by mistake.
    if (
      sameEndpoint(origin, destination) &&
      !window.confirm('The collection and delivery addresses are the same. Book this shipment anyway?')
    ) {
      return;
    }
    submitInFlight.current = true;
    setBooking(true);
    setErr(null);
    if (!attemptKey.current) attemptKey.current = crypto.randomUUID();
    try {
      // Written BEFORE the request goes out, not after -- a reload can land
      // at any point while the request is in flight, including before any
      // response (Case 3), so the key must already be durable the moment the
      // attempt starts. Storage failing here must not block booking: it just
      // leaves this attempt's key living only in the ref, i.e. today's
      // behaviour (Case 2 still fixed; a reload mid-submit is not).
      try {
        sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify({ key: attemptKey.current, fingerprint: fingerprint(request) }));
      } catch {
        // Degrade to in-memory-only; see comment above.
      }
      const created = await shippingApi.create({ ...request, payWithWallet: true }, attemptKey.current);
      // A completed booking's key must never be available to restore into a
      // later, unrelated attempt -- clear it before navigating away, not after.
      try {
        sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
      } catch {
        // Nothing to degrade to here -- we are leaving the page regardless.
      }
      router.push(`/dashboard/shipments/${encodeURIComponent(created.reference)}`);
    } catch (e) {
      // DO NOT auto-retry and DO NOT try to infer success from the failure
      // shape here — a server-told error (isApiError) is shown as the
      // server worded it; anything else (dropped connection, abort, timeout)
      // gets the honest "we don't know" message, never the raw browser/network
      // error text, which would read as gibberish rather than guidance.
      setErr(isApiError(e) ? e.errors?.[0]?.message ?? e.message ?? 'We could not book that shipment.' : CONNECTION_LOST_MESSAGE);
      setBooking(false);
      submitInFlight.current = false;
    }
  }

  // Only a priced quote has a total to compare against; an unavailable one is
  // blocked for its own reason further up.
  const priced = quote?.available === true ? quote : null;
  const affordable = wallet == null || priced == null || wallet.availableMinor >= priced.totalMinor;
  const canBook = priced != null && !priced.pricingIncomplete && !booking && affordable;

  /**
   * MDF-559 (owner-reported, measured by Jim at 390x844): every one of these
   * reasons already existed somewhere on this page -- the ready-gate text,
   * the planner's own `quote.message`, the pricing note, the wallet
   * shortfall sentence. The defect was never a missing message; it was that
   * the quote panel carrying it scrolls away while this bar stays pinned to
   * the bottom (MDF-376), so the control and its one reason were never
   * guaranteed on screen together. Restating the SAME sentence beside the
   * button, never a new one, is the fix -- same pattern as `addressGap()`
   * beside "Save to my addresses" (MDF-554).
   *
   * Order matters: an unavailable quote (no hub, no coverage, bad date) and
   * a wallet shortfall are mutually exclusive by construction (`priced` is
   * null in the first case), but an incomplete-pricing quote is also
   * `available: true`, so it must be checked before affordability or a
   * configuration gap would be reported as a money problem.
   */
  const blockReason: string | null = booking
    ? null
    : !ready
      ? 'Tell us the town at each end and we will price the whole journey.'
      : quote && !quote.available
        ? quote.message
        : quote?.available && quote.pricingIncomplete
          ? `${quote.pricingNote ?? ''} We cannot take this booking until that is set — please contact us.`.trim()
          : quote?.available && wallet && wallet.availableMinor < quote.totalMinor
            ? `Insufficient wallet balance. ${shortfallSentence(quote.totalMinor, wallet.availableMinor)}`
            : quoting
              ? 'Working out your route…'
              : null;

  return (
    // No manual bottom padding here any more -- StickyActionBar now reserves
    // its own space (MDF-376); a hand-guessed pb-28 would just double it up.
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Ship a package" description="Send a parcel anywhere in Belize — by road, air or boat." />

      {/* 1. What kind of service. Chosen first because it decides which fields
             the rest of the form even shows. */}
      <div className="bmpl-surface-onlight mt-6 rounded-bmpl-xl border p-4 shadow-bmpl-sm sm:p-5">
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

      <FormCard legend="How should it travel?" className="mt-4">
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
              className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base text-slate-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Pieces</span>
            <input
              value={parcel.pieces}
              onChange={(e) => setParcel((p) => ({ ...p, pieces: e.target.value }))}
              inputMode="numeric"
              className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base text-slate-900"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Travel date</span>
            <input
              type="date"
              value={travelDate}
              min={todayKey()}
              onChange={(e) => setTravelDate(e.target.value || todayKey())}
              className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base text-slate-900"
            />
          </label>
        </div>
      </FormCard>

      {/* 2. The quote. One price, and the journey that produced it. */}
      <div className="mt-4">
        {!ready && (
          <p className="bmpl-surface-onlight rounded-bmpl-xl border border-dashed p-4 text-sm text-[color:var(--bmpl-oncolor-light-text-muted)]">
            Tell us the town at each end and we will price the whole journey.
          </p>
        )}

        {ready && quoting && !quote && (
          <div className="bmpl-surface-onlight flex items-center gap-2 rounded-bmpl-xl border p-4 text-sm text-[color:var(--bmpl-oncolor-light-text-muted)]">
            <Spinner className="h-4 w-4" /> Working out your route…
          </div>
        )}

        {quote && !quote.available && (
          <Alert tone="warning">
            {/* The planner's own words. When the date is the reason, this already
                names the next confirmed date, because the API only ever includes
                one it verified itself by re-running the real planner against it —
                never a guess from partial schedule rows. */}
            {quote.message}
            {/* ROUTE-SAME-DISTRICT-DOOR-TO-HUB-REFUSED-AS-LOCAL-DELIVERY: the old
                copy here ("order through the marketplace") was advice for buying
                goods -- a person sending a parcel has no order to place, so it
                pointed nowhere. Door to door is the service type that actually
                covers a run like this; the switch happens right here rather than
                asking the customer to find the Service type dropdown unaided.
                Deliberately not "this will work" -- a local run can still be
                refused on its own (an unconfigured courier fee), so this only
                offers the applicable route, never a promise it completes. */}
            {quote.useLocalDelivery && (
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <span className="block w-full">
                  A delivery inside one town does not need a terminal. Door to door is the service type for a run
                  like this — switch to see what it would cost.
                </span>
                <button
                  type="button"
                  onClick={() => setService('DOOR_TO_DOOR')}
                  className="min-h-[36px] rounded-full border border-belize-blue px-3 text-sm font-medium text-belize-blue hover:bg-belize-blue hover:text-white"
                >
                  Switch to Door to door
                </button>
              </span>
            )}
            {quote.dateUnavailable && quote.nextAvailableDate && (
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTravelDate(quote.nextAvailableDate!)}
                  className="min-h-[36px] rounded-full border border-belize-blue px-3 text-sm font-medium text-belize-blue hover:bg-belize-blue hover:text-white"
                >
                  Use {quote.nextAvailableDate}
                </button>
              </span>
            )}
            {/* The owner's own prohibition, made visible rather than left to a
                silent gap: when the schedule cannot confirm a next date, the UI
                says so plainly instead of quietly showing nothing — the customer
                is left with a date to try again, not a dead end that looks like
                one more error. */}
            {quote.dateUnavailable && !quote.nextAvailableDate && (
              <span className="mt-1 block">
                We could not confirm a date this route runs within the next two weeks. Try a different date, or
                contact us.
              </span>
            )}
          </Alert>
        )}

        {quote?.available && (
          <div className="bmpl-surface-onlight rounded-bmpl-xl border p-4 shadow-bmpl-sm sm:p-5">
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
        <div className="bmpl-surface-onlight mt-4 rounded-bmpl-xl border p-4 shadow-bmpl-sm sm:p-5">
          <h2 className="text-sm font-semibold text-belize-navy">Review and pay</h2>

          <dl className="mt-3 space-y-1.5 text-sm">
            <Line label="Service" value={quote.serviceLabel} />
            <Line label="From" value={[origin.city, origin.district.replace(/_/g, ' ')].filter(Boolean).join(', ') || '—'} />
            <Line label="To" value={[destination.city, destination.district.replace(/_/g, ' ')].filter(Boolean).join(', ') || '—'} />
            <Line label="Parcel" value={`${parcel.pieces || 1} × ${parcel.description || 'parcel'}`} />
            <Line label="Transport" value={mode === 'ANY' ? 'Best available' : TRANSPORT_MODE_LABELS[mode as TransportMode]} />
            <Line label="Travel date" value={quote.requestedDate} />
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
                <span className="font-semibold">Insufficient wallet balance.</span>{' '}
                {shortfallSentence(quote.totalMinor, wallet.availableMinor)}
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
             without scrolling back down a long form. StickyActionBar carries
             the stacking-context floor and the iPhone safe-area padding --
             see components/ui.tsx for why both are the bar's job, not a
             one-off class here. */}
      <StickyActionBar className="sm:static sm:mt-4 sm:border-0 sm:bg-transparent sm:pt-0 sm:pb-0">
        <div className="mx-auto max-w-2xl">
          {/* MDF-559: the one reason the button below is disabled, restated
              here rather than left up in the quote panel, which this bar's
              own pinning (MDF-376) can scroll out of view while the button
              stays reachable -- see `blockReason` above for why. */}
          {blockReason && <p className="mb-2 text-sm text-amber-700">{blockReason}</p>}
          <div className="flex items-center gap-3">
            {quote?.available && (
              <span className="shrink-0 text-lg font-bold tabular-nums text-belize-navy sm:hidden">
                {shippingMoney(quote.totalMinor)}
              </span>
            )}
            {/* Never "Book" — booking now takes the money, and the button should
                say so before it is pressed. */}
            {/* `canBook` already folds in `!booking`, so this is redundant today --
                it is here so the button staying disabled through the request
                cannot silently regress if `canBook`'s own definition ever drops
                that clause; the ref (submitInFlight, above) is what actually
                keeps a double-submit safe either way. */}
            <Button onClick={book} disabled={!canBook || booking} className="min-h-[48px] w-full text-base">
              {booking
                ? 'Paying…'
                : quote?.available
                  ? `Pay ${shippingMoney(quote.totalMinor)} & book shipment`
                  : 'Pay & book shipment'}
            </Button>
          </div>
        </div>
      </StickyActionBar>
    </div>
  );
}

/** One label/value row in the review panel. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { shippingApi } from '../../lib/shipping';
import { Alert, LoadingRow } from '../ui';

/**
 * CLOSE-2, linked-recipient path: a claimed shipment's own delivery
 * (handoff) code, shown to the driver when the parcel arrives.
 *
 * `deliveryCode: null` is a normal response here, not a failure — the API
 * returns null once the shipment is delivered or cancelled, and a service
 * that ends at a hub (the recipient collects in person) never had a handoff
 * code to begin with. This component cannot tell those apart client-side and
 * does not try to: it always renders the same quiet "nothing to show"
 * message rather than hiding the card or treating null as an error, same
 * spirit as RecipientAvailabilityWindow's own graceful-degradation choice.
 */
export function RecipientDeliveryCode({ reference }: { reference: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    shippingApi
      .incomingDeliveryCode(reference)
      .then((v) => {
        if (cancelled) return;
        setCode(v.deliveryCode);
      })
      .catch(() => {
        if (!cancelled) setErr('We could not load your delivery code right now.');
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reference]);

  if (!loaded) {
    return <LoadingRow />;
  }

  return (
    <div data-theme="light" className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900">Your delivery code</h2>

      {err ? (
        <Alert tone="warning" className="mt-3">
          {err}
        </Alert>
      ) : code ? (
        <>
          <p className="mt-1 text-sm text-slate-600">
            Share this with your driver when your parcel arrives, so they know it&rsquo;s you.
          </p>
          <p className="mt-3 text-center text-3xl font-bold tracking-[0.3em] text-belize-navy">{code}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-600">No delivery code to show for this parcel right now.</p>
      )}
    </div>
  );
}

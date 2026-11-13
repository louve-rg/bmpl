'use client';

import { useEffect, useState } from 'react';
import { shippingApi } from '../../lib/shipping';
import { Alert, LoadingRow } from '../ui';

/**
 * MDF-738 (Item 11): a claimed shipment's own collection code, shown to the
 * terminal when the recipient comes to collect in person -- the
 * linked-recipient counterpart to `RecipientDeliveryCode`, for a service
 * that ends at a hub instead of a door.
 *
 * Before this existed, a signed-in recipient was WORSE OFF than a stranger:
 * #700 gave an unlinked recipient a full mail → token → reveal path, while
 * an account holder who claimed the exact same shipment had no screen at
 * all for the identical fact. Already being the authenticated, genuinely
 * linked recipient (`recipientUserId`, checked server-side) IS the
 * authentication here -- no email, no token, no second step.
 *
 * `collectionCode: null` is a normal response, not a failure -- same
 * reasoning as `RecipientDeliveryCode`'s own null handling: the API
 * returns null once the shipment is no longer AWAITING_COLLECTION
 * (collected, cancelled, or grandfathered). This component cannot tell
 * those apart client-side and does not try to.
 */
export function RecipientCollectionCode({ reference }: { reference: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    shippingApi
      .incomingCollectionCode(reference)
      .then((v) => {
        if (cancelled) return;
        setCode(v.collectionCode);
      })
      .catch(() => {
        if (!cancelled) setErr('We could not load your collection code right now.');
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
      <h2 className="text-sm font-semibold text-slate-900">Your collection code</h2>

      {err ? (
        <Alert tone="warning" className="mt-3">
          {err}
        </Alert>
      ) : code ? (
        <>
          <p className="mt-1 text-sm text-slate-600">
            Show this at the terminal counter when you collect your parcel.
          </p>
          <p className="mt-3 text-center text-3xl font-bold tracking-[0.3em] text-belize-navy">{code}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-600">No collection code to show for this parcel right now.</p>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RecipientTracking } from '../../../../components/shipping/RecipientTracking';
import { Alert, Spinner } from '../../../../components/ui';
import type { ApiError } from '../../../../lib/api';
import { shippingApi, type RecipientTrackingView } from '../../../../lib/shipping';

/**
 * One claimed shipment, from the account's OWN "incoming" list (BMPL-179).
 *
 * Same `<RecipientTracking>` presentation the anonymous `/track/[token]` page
 * uses — claiming changes where this can be read from, never what is in it.
 * A reference this account never claimed answers the same 404 as one that
 * does not exist at all (`shipment.service.ts#trackAsRecipient`), so this
 * page shows one neutral message for every miss.
 */
export default function IncomingShipmentPage() {
  const params = useParams<{ reference: string }>();
  const router = useRouter();
  const reference = String(params.reference ?? '');

  const [view, setView] = useState<RecipientTrackingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    shippingApi
      .incomingOne(reference)
      .then((v) => {
        setView(v);
        setNotFound(false);
      })
      .catch((e) => {
        if ((e as ApiError).status === 401) {
          router.push(`/login?next=${encodeURIComponent(`/dashboard/incoming/${reference}`)}`);
          return;
        }
        setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [reference, router]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }

  if (notFound || !view) {
    return (
      <Alert tone="warning">
        We couldn&rsquo;t find that parcel in your account. It may not have been saved here, or the reference is wrong.
      </Alert>
    );
  }

  return <RecipientTracking view={view} />;
}

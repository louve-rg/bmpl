'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { shippingApi, type ShipmentView } from '../../../../lib/shipping';
import { ShipmentJourney } from '../../../../components/shipping/ShipmentJourney';
import { ShareTrackingLink } from '../../../../components/shipping/ShareTrackingLink';
import { Alert, Button, Spinner } from '../../../../components/ui';
import type { ApiError } from '../../../../lib/api';

/**
 * Tracking one shipment.
 *
 * Refreshed on focus rather than on a timer: somebody checking on a parcel opens
 * the tab, looks, and goes away again. Polling every few seconds would spend
 * their data on a status that changes a handful of times over several days.
 */
export default function TrackShipmentPage() {
  const params = useParams<{ reference: string }>();
  const reference = decodeURIComponent(String(params.reference ?? ''));

  const [shipment, setShipment] = useState<ShipmentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      setShipment(await shippingApi.track(reference));
      setErr(null);
    } catch (e) {
      setErr(
        (e as ApiError).status === 404
          ? 'We could not find a shipment with that reference on your account.'
          : 'We could not load this shipment just now.',
      );
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  async function cancel() {
    if (!shipment) return;
    const reason = window.prompt('Why are you cancelling this shipment?')?.trim();
    if (!reason || reason.length < 4) return;
    setCancelling(true);
    try {
      setShipment(await shippingApi.cancel(shipment.id, reason));
    } catch (e) {
      setErr((e as ApiError).message ?? 'We could not cancel this shipment.');
    } finally {
      setCancelling(false);
    }
  }

  // Cancellable only while nothing has moved. Once a leg is under way the
  // customer is told to contact support instead of being shown a button that
  // will refuse them.
  const canCancel =
    shipment != null &&
    !shipment.cancelledAt &&
    shipment.legs.every((l) => l.status === 'PENDING' || l.status === 'READY');

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard/shipments" className="text-sm text-belize-blue hover:underline">
        ← All shipments
      </Link>

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}
      {err && (
        <Alert tone="warning" className="mt-6">
          {err}
        </Alert>
      )}

      {shipment && (
        <div className="mt-4 space-y-4">
          <ShipmentJourney shipment={shipment} />

          {/* The recipient has no account and no channel of their own — the
              sender hands them the link. Shown only once the API has minted a
              token for this shipment. */}
          {shipment.recipientTrackingToken && !shipment.cancelledAt && (
            <ShareTrackingLink token={shipment.recipientTrackingToken} reference={shipment.reference} />
          )}

          {canCancel && (
            <div className="mt-4">
              <Button onClick={cancel} disabled={cancelling} className="min-h-[44px] w-full sm:w-auto">
                {cancelling ? 'Cancelling…' : 'Cancel this shipment'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

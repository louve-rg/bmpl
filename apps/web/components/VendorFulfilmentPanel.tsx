'use client';

import { useState } from 'react';
import { type ApiError } from '../lib/api';
import { ordersApi } from '../lib/orders';
import { Alert, Button, Card, Spinner } from './ui';

type Status = 'PENDING' | 'PREPARING' | 'READY_FOR_PICKUP' | 'PICKED_UP' | 'CANCELLED';

/**
 * The vendor's fulfilment controls for a DELIVERY order.
 *
 * This is the missing half of the dead end M26.3 set out to fix: the API could
 * move a delivery order through preparation and hand it to dispatch, but the
 * vendor had no button to do it with, so the order still went nowhere.
 *
 * Two steps, in the order a vendor actually works: acknowledge the order and
 * start packing, then say it's packed. The second one is what releases the job
 * to a driver, so it is deliberately the more committing-looking action and
 * spells out what happens next — a vendor should never wonder whether pressing
 * it summoned a driver.
 *
 * PICKUP orders keep VendorPickupPanel, which already works.
 */
export function VendorFulfilmentPanel({
  vendorOrderId,
  status,
  onChanged,
}: {
  vendorOrderId: string;
  status: Status;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'prepare' | 'ready' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(step: 'prepare' | 'ready') {
    setBusy(step);
    setError(null);
    try {
      if (step === 'prepare') await ordersApi.vendorStartPreparing(vendorOrderId);
      else await ordersApi.vendorMarkReady(vendorOrderId);
      onChanged();
    } catch (e) {
      setError((e as ApiError).message || 'That didn’t go through. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  if (status === 'CANCELLED') return null;

  // Once the order is out for delivery the driver owns it; VendorDeliveryPanel
  // shows progress and there is nothing left for the vendor to press here.
  if (status === 'READY_FOR_PICKUP' || status === 'PICKED_UP') {
    return (
      <Card className="p-4">
        <p className="bmpl-label">Fulfilment</p>
        <Alert tone="success" className="mt-2">
          {status === 'PICKED_UP'
            ? 'Collected by the driver and on its way to the customer.'
            : 'Packed and waiting for a driver. You’ll be notified when one is on the way.'}
        </Alert>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <p className="bmpl-label">Fulfilment</p>
      <p className="mt-1 text-sm text-slate-500">
        {status === 'PENDING'
          ? 'Let the customer know you’ve seen their order and started putting it together.'
          : 'When everything is packed, mark it ready and we’ll find a driver automatically.'}
      </p>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      {/* Stacks on narrow screens; full-width targets so a phone in one hand at a
          counter is not a precision exercise. */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {status === 'PENDING' && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={busy !== null}
            onClick={() => run('prepare')}
          >
            {busy === 'prepare' ? <Spinner className="h-4 w-4" /> : 'Start preparing'}
          </Button>
        )}
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={busy !== null}
          onClick={() => run('ready')}
        >
          {busy === 'ready' ? <Spinner className="h-4 w-4" /> : 'Mark ready for driver'}
        </Button>
      </div>
    </Card>
  );
}

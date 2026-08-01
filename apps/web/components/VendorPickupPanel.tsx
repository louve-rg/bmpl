'use client';

import { useState } from 'react';
import { ordersApi } from '../lib/orders';
import type { ApiError } from '../lib/api';
import { Alert, Button, Card, Input, StatusBadge } from './ui';

/**
 * Vendor pickup-fulfilment controls for a PICKUP vendor-order (M18.1).
 * PENDING → mark ready · READY_FOR_PICKUP → confirm collection with the
 * customer's PIN · PICKED_UP → collected confirmation.
 */
export function VendorPickupPanel({
  vendorOrderId,
  status,
  pickedUpAt,
  onChanged,
}: {
  vendorOrderId: string;
  status: string;
  pickedUpAt?: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  async function markReady() {
    setBusy(true);
    setErr(null);
    try {
      await ordersApi.vendorReadyForPickup(vendorOrderId);
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not mark this order ready.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPickup(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await ordersApi.vendorConfirmPickup(vendorOrderId, pin.trim());
      setPin('');
      onChanged();
    } catch (e2) {
      setErr((e2 as ApiError).message ?? 'Could not confirm pickup.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="bmpl-label">Pickup fulfilment</p>
        <StatusBadge status={status} />
      </div>

      {status === 'PENDING' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            When this order is packed and waiting at the counter, mark it ready so the customer gets
            their pickup code.
          </p>
          <Button type="button" size="sm" onClick={markReady} disabled={busy}>
            {busy ? 'Marking…' : 'Mark ready for pickup'}
          </Button>
        </div>
      )}

      {status === 'READY_FOR_PICKUP' && (
        <form className="space-y-3" onSubmit={confirmPickup}>
          <p className="text-sm font-medium text-belize-navy">Ready for pickup</p>
          <p className="text-xs text-slate-500">Ask the customer for their pickup code.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              value={pin}
              onChange={(ev) => setPin(ev.target.value)}
              placeholder="Pickup code"
              inputMode="numeric"
              autoComplete="off"
              aria-label="Pickup code"
              className="max-w-[10rem] font-mono tracking-[0.2em]"
              disabled={busy}
            />
            <Button type="submit" size="sm" disabled={busy || !pin.trim()}>
              {busy ? 'Confirming…' : 'Confirm pickup'}
            </Button>
          </div>
        </form>
      )}

      {status === 'PICKED_UP' && (
        <div className="rounded-bmpl-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-emerald-800">Collected ✓</p>
          {pickedUpAt && (
            <p className="mt-0.5 text-xs text-emerald-700">{new Date(pickedUpAt).toLocaleString()}</p>
          )}
        </div>
      )}

      {status === 'CANCELLED' && (
        <p className="text-sm text-slate-500">This order was cancelled.</p>
      )}

      {err && (
        <Alert tone="error" className="mt-3">
          {err}
        </Alert>
      )}
    </Card>
  );
}

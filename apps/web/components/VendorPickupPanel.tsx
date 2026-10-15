'use client';

import { useState } from 'react';
import { ordersApi } from '../lib/orders';
import type { ApiError } from '../lib/api';
import { Alert, Button, Card, Input, Spinner, StatusBadge } from './ui';

/**
 * Vendor pickup-fulfilment controls for a PICKUP vendor-order (M18.1).
 * PENDING → optionally start preparing → mark ready · READY_FOR_PICKUP →
 * confirm collection with the customer's PIN · PICKED_UP → collected
 * confirmation.
 *
 * PREPARING mirrors VendorFulfilmentPanel's delivery flow (god,
 * conv-modules-2026-10-14, Edward req 10 follow-on): once #409 gave a pickup
 * customer a per-vendor status badge, that badge had nowhere to go but
 * PENDING until it jumped straight to READY_FOR_PICKUP. The step is
 * OPTIONAL — PENDING → ready remains valid, exactly as on the delivery
 * panel — a vendor who skips preparing must still be able to mark ready
 * directly. Needs PickupService#markReadyForPickup to accept PREPARING too
 * (pickup.service.ts:66, landing separately) — do not open this without
 * that merged first, or a vendor who DOES press "Start preparing" walks
 * straight into a 409 on "Mark ready for pickup" that a vendor who skips it
 * never hits.
 *
 * "Mark ready" calls `vendorMarkReady` (`/vendor/orders/:id/ready`, the same
 * call the delivery panel makes) — not the older `/ready-for-pickup` route,
 * which the controller flags `@deprecated` in favour of `:id/ready` ("handles
 * both pickup and delivery"). The client wrapper for that deprecated route
 * (`ordersApi.vendorReadyForPickup`) has since been deleted as dead code —
 * it had zero remaining call sites once this panel stopped using it. The
 * API route itself is untouched; this retires only the client-side name. For
 * a PICKUP order both routes delegate to the identical
 * `PickupService#markReadyForPickup` underneath, so switching changed no
 * observable behaviour; it gives this one action the same shape as the
 * delivery panel's single `run('ready')` regardless of which state it is
 * called from, instead of needing two different calls depending on whether
 * preparing was pressed.
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
  const [busy, setBusy] = useState<'prepare' | 'ready' | 'confirm' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  async function run(step: 'prepare' | 'ready') {
    setBusy(step);
    setErr(null);
    try {
      if (step === 'prepare') await ordersApi.vendorStartPreparing(vendorOrderId);
      else await ordersApi.vendorMarkReady(vendorOrderId);
      onChanged();
    } catch (e) {
      setErr(
        (e as ApiError).message ??
          (step === 'prepare' ? 'Could not start preparing this order.' : 'Could not mark this order ready.'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function confirmPickup(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim()) return;
    setBusy('confirm');
    setErr(null);
    try {
      await ordersApi.vendorConfirmPickup(vendorOrderId, pin.trim());
      setPin('');
      onChanged();
    } catch (e2) {
      setErr((e2 as ApiError).message ?? 'Could not confirm pickup.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="bmpl-label">Pickup fulfilment</p>
        <StatusBadge status={status} />
      </div>

      {(status === 'PENDING' || status === 'PREPARING') && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {status === 'PENDING'
              ? 'Let the customer know you’ve seen their order and started putting it together.'
              : 'When this order is packed and waiting at the counter, mark it ready so the customer gets their pickup code.'}
          </p>
          {/* Stacks on narrow screens; full-width targets so a phone in one
              hand at a counter is not a precision exercise — same shape as
              VendorFulfilmentPanel's own button row. */}
          <div className="flex flex-col gap-2 sm:flex-row">
            {status === 'PENDING' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                disabled={busy !== null}
                onClick={() => run('prepare')}
              >
                {busy === 'prepare' ? <Spinner className="h-4 w-4" /> : 'Start preparing'}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto"
              disabled={busy !== null}
              onClick={() => run('ready')}
            >
              {busy === 'ready' ? <Spinner className="h-4 w-4" /> : 'Mark ready for pickup'}
            </Button>
          </div>
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
              disabled={busy !== null}
            />
            <Button type="submit" size="sm" disabled={busy !== null || !pin.trim()}>
              {busy === 'confirm' ? 'Confirming…' : 'Confirm pickup'}
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

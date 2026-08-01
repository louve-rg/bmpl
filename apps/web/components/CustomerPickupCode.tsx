'use client';

import { useEffect, useState } from 'react';
import { ordersApi, type PickupPinView } from '../lib/orders';

/**
 * Customer-facing pickup code for a PICKUP vendor-order (M18.1). Renders the
 * code prominently while READY_FOR_PICKUP and a "Collected" note once picked up.
 * Only mount this for PICKUP vendor-orders.
 */
export function CustomerPickupCode({ vendorOrderId }: { vendorOrderId: string }) {
  const [pin, setPin] = useState<PickupPinView | null>(null);

  useEffect(() => {
    let active = true;
    ordersApi
      .pickupPin(vendorOrderId)
      .then((p) => active && setPin(p))
      .catch(() => active && setPin(null));
    return () => {
      active = false;
    };
  }, [vendorOrderId]);

  if (!pin) return null;

  if (pin.status === 'READY_FOR_PICKUP' && pin.pickupPin) {
    return (
      <div className="border-t border-slate-100 px-4 py-3">
        <p className="bmpl-label">Pickup code</p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-belize-navy">
          {pin.pickupPin}
        </p>
        <p className="mt-1 text-xs text-slate-500">Show this code to the store to collect your order.</p>
      </div>
    );
  }

  if (pin.status === 'PICKED_UP') {
    return (
      <div className="border-t border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-emerald-700">Collected ✓</p>
        {pin.pickedUpAt && (
          <p className="mt-0.5 text-xs text-slate-500">{new Date(pin.pickedUpAt).toLocaleString()}</p>
        )}
      </div>
    );
  }

  return null;
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { headlineFor, shippingApi, shippingMoney, type ShipmentView } from '../../../lib/shipping';
import { PageHeader, Alert, EmptyState, Spinner, Badge, type Tone } from '../../../components/ui';

/**
 * The customer's shipments.
 *
 * Deliberately separate from Orders: a shipment can exist without a purchase
 * (sending your own parcel across the country), and an order that ships locally
 * has no shipment at all. Merging them would mean explaining to every customer
 * why some orders have legs and others do not.
 */

const TONE_FOR: Record<string, Tone> = {
  DELIVERED: 'success',
  AWAITING_COLLECTION: 'success',
  CANCELLED: 'neutral',
  EXCEPTION: 'warning',
};

export default function ShipmentsPage() {
  const [rows, setRows] = useState<ShipmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    shippingApi
      .mine()
      .then(setRows)
      .catch(() => setErr('We could not load your shipments just now. Try again in a moment.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        title="Shipments"
        description="Parcels travelling between towns — by road, air or boat. Local deliveries appear under Orders."
      />

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
      {!loading && !err && rows.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="No shipments yet"
            description="When you send something between towns, you will be able to follow the whole journey here."
          />
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {rows.map((s) => (
          <li key={s.id}>
            {/* The whole card is the tap target — a 44px-plus row is far easier
                to hit on a phone than a small "track" link at the end. */}
            <Link
              href={`/dashboard/shipments/${encodeURIComponent(s.reference)}`}
              className="block rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm transition hover:border-belize-blue/40 hover:shadow-bmpl-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{s.reference}</p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{headlineFor(s)}</p>
                </div>
                <Badge tone={TONE_FOR[s.status] ?? 'info'}>{s.serviceLabel}</Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-600">{s.explanation}</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{shippingMoney(s.quotedTotalMinor)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

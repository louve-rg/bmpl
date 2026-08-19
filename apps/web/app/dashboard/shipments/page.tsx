'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { headlineFor, shippingApi, shippingMoney, type ShipmentView } from '../../../lib/shipping';
import { PageHeader, Alert, ButtonLink, EmptyState, Spinner, Badge, type Tone } from '../../../components/ui';

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

/**
 * Four groups, in the order they need attention.
 *
 * "Ready to collect" is its own group rather than living under Active, because
 * it is the only state that needs the customer to physically do something. Burying
 * it among parcels still in transit is how a box sits on a counter for a week.
 */
const GROUPS = [
  { key: 'COLLECT', title: 'Ready to collect', hint: 'Waiting for you at a terminal.' },
  { key: 'ACTIVE', title: 'On the way', hint: null },
  { key: 'ATTENTION', title: 'Needs attention', hint: null },
  { key: 'DONE', title: 'Completed', hint: null },
] as const;

function groupOf(s: ShipmentView): (typeof GROUPS)[number]['key'] {
  if (s.status === 'AWAITING_COLLECTION') return 'COLLECT';
  if (s.status === 'EXCEPTION') return 'ATTENTION';
  if (s.status === 'DELIVERED' || s.status === 'CANCELLED') return 'DONE';
  return 'ACTIVE';
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-BZ', { day: 'numeric', month: 'short' });
}

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Shipments"
          description="Parcels travelling between towns — by road, air or boat. Local deliveries appear under Orders."
        />
        <ButtonLink href="/dashboard/shipments/new" className="min-h-[44px] shrink-0">
          Ship a package
        </ButtonLink>
      </div>

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
            action={<ButtonLink href="/dashboard/shipments/new">Ship a package</ButtonLink>}
          />
        </div>
      )}

      {GROUPS.map((group) => {
        const rows_ = rows.filter((s) => groupOf(s) === group.key);
        if (rows_.length === 0) return null;
        return (
          <section key={group.key} className="mt-6">
            <h2 className="text-sm font-semibold text-belize-navy">
              {group.title} <span className="font-normal text-slate-400">({rows_.length})</span>
            </h2>
            {group.hint && <p className="mt-0.5 text-xs text-slate-500">{group.hint}</p>}
            <ul className="mt-2 space-y-3">
              {rows_.map((s) => (
                <li key={s.id}>
                  {/* The whole card is the tap target — a 44px-plus row is far
                      easier to hit on a phone than a small "track" link. */}
                  <Link
                    href={`/dashboard/shipments/${encodeURIComponent(s.reference)}`}
                    className="block rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm transition hover:border-belize-blue/40 hover:shadow-bmpl-md"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-wide text-slate-500">{s.reference}</p>
                        <p className="mt-0.5 break-words text-sm font-semibold text-slate-900">{headlineFor(s)}</p>
                      </div>
                      <Badge tone={TONE_FOR[s.status] ?? 'info'}>{s.serviceLabel}</Badge>
                    </div>
                    {/* Both ends, wrapping rather than truncating: a hub name
                        cut to "San Pedro Water Taxi Termi…" helps nobody. */}
                    <p className="mt-2 break-words text-xs text-slate-600">
                      {[s.origin.city ?? s.origin.district, s.destination.city ?? s.destination.district]
                        .filter(Boolean)
                        .join(' → ') || s.explanation}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-sm font-medium tabular-nums text-slate-900">
                        {shippingMoney(s.quotedTotalMinor)}
                      </span>
                      {s.bookedAt && <span className="text-xs text-slate-400">Booked {formatDate(s.bookedAt)}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

    </div>
  );
}

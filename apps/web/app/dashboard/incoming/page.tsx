'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { destinationLine, recipientHeadline } from '../../../lib/recipient-tracking';
import { shippingApi, type RecipientTrackingView } from '../../../lib/shipping';
import type { ApiError } from '../../../lib/api';
import { PageHeader, Alert, Badge, EmptyState, Spinner, type Tone } from '../../../components/ui';

/**
 * Shipments this account has CLAIMED as recipient (BMPL-179).
 *
 * Deliberately separate from `/dashboard/shipments`: that page is the SENDER's
 * view (money, full leg detail, cancel) of parcels this account booked. This
 * page is the RECIPIENT's view — the same deliberately minimal allowlist
 * `/track/[token]` already shows anonymously, just reachable from the account
 * a claim linked it to instead of a saved link. No role is required to reach
 * it: the recipient need not be a CUSTOMER.
 */

const TONE_FOR: Record<string, Tone> = {
  DELIVERED: 'success',
  AWAITING_COLLECTION: 'success',
  CANCELLED: 'neutral',
  EXCEPTION: 'warning',
};

export default function IncomingShipmentsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<RecipientTrackingView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    shippingApi
      .incoming()
      .then(setRows)
      .catch((e) => {
        if ((e as ApiError).status === 401) router.push(`/login?next=${encodeURIComponent('/dashboard/incoming')}`);
        else setErr('We could not load your incoming parcels just now. Try again in a moment.');
      });
  }, [router]);

  return (
    <div>
      <PageHeader
        title="Incoming parcels"
        description="Parcels you've saved to your account from a tracking link. The sender's own view has more detail — this is what a recipient sees."
      />

      {!rows && !err && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}
      {err && (
        <Alert tone="warning" className="mt-6">
          {err}
        </Alert>
      )}
      {rows && rows.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="No incoming parcels yet"
            description="Open a tracking link someone sent you and choose “Save to my account” to see it here."
          />
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="mt-6 space-y-3">
          {rows.map((s) => (
            <li key={s.reference}>
              <Link
                href={`/dashboard/incoming/${encodeURIComponent(s.reference)}`}
                className="block rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm transition hover:border-belize-blue/40 hover:shadow-bmpl-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-slate-500">{s.reference}</p>
                    <p className="mt-0.5 break-words text-sm font-semibold text-slate-900">{recipientHeadline(s)}</p>
                  </div>
                  <Badge tone={TONE_FOR[s.status] ?? 'info'}>{s.serviceLabel}</Badge>
                </div>
                {destinationLine(s) && <p className="mt-2 break-words text-xs text-slate-600">Going to {destinationLine(s)}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

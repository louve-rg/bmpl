'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { type ApiError } from '../../../../lib/api';
import {
  realEstateApi,
  fmtDate,
  enquiryTypeLabel,
  enquiryStatusLabel,
  type EnquiryCard,
} from '../../../../lib/realestate';
import { ENQUIRY_STATUS_TONE } from '../../../../components/realestate/status';
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Spinner } from '../../../../components/ui';

export default function MyEnquiriesPage() {
  const [items, setItems] = useState<EnquiryCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    realEstateApi.seeker
      .enquiries()
      .then((r) => active && setItems(r))
      .catch((e) => active && setError((e as ApiError).message ?? 'Failed to load enquiries.'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Real Estate" title="My enquiries" description="Every property you've inquired about." />

      {error && <Alert tone="error">{error}</Alert>}

      {items === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState
          title="No inquiries yet"
          description="When you inquire about a property it'll appear here."
          action={<ButtonLink href="/properties">Browse properties</ButtonLink>}
        />
      ) : (
        <div className="overflow-hidden rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items?.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/properties/${e.listing.slug}`} className="font-medium text-belize-navy hover:text-belize-blue">
                      {e.listing.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{enquiryTypeLabel(e.type)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(e.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={ENQUIRY_STATUS_TONE[e.status]}>{enquiryStatusLabel(e.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/properties/enquiries/${e.id}`} className="text-xs font-semibold text-belize-blue hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

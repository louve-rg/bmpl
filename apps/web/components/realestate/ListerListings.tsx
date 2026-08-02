'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PROPERTY_STATUSES, PROPERTY_STATUS_LABELS, type PropertyStatus } from '@bmpl/shared';
import { type ApiError } from '../../lib/api';
import { type PropertyCard, formatPrice, fmtDate } from '../../lib/realestate';
import { StatusBadge } from './StatusBadge';
import { Alert, ButtonLink, EmptyState, PageHeader, Spinner } from '../ui';

export interface ListingsApi {
  listings: (status?: string) => Promise<PropertyCard[]>;
}

/** Listings table for an owner or agent, with a status filter and status chips. */
export function ListerListings({
  api,
  eyebrow,
  title,
  description,
  detailBase,
  newHref,
  emptyDescription,
  onForbidden,
}: {
  api: ListingsApi;
  eyebrow: string;
  title: string;
  description: string;
  detailBase: string;
  newHref?: string;
  emptyDescription: string;
  onForbidden: () => void;
}) {
  const [rows, setRows] = useState<PropertyCard[] | null>(null);
  const [status, setStatus] = useState<PropertyStatus | ''>('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.listings(status || undefined));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) onForbidden();
      else setError(err.message ?? 'Failed to load.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          newHref ? (
            <ButtonLink href={newHref} size="sm">
              + New listing
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filter:</span>
        <FilterChip label="All" active={status === ''} onClick={() => setStatus('')} />
        {PROPERTY_STATUSES.map((s) => (
          <FilterChip key={s} label={PROPERTY_STATUS_LABELS[s]} active={status === s} onClick={() => setStatus(s)} />
        ))}
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {rows === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows && rows.length === 0 ? (
        <EmptyState
          title="No listings here yet"
          description={emptyDescription}
          action={newHref ? <ButtonLink href={newHref}>+ New listing</ButtonLink> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Listing</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Enquiries</th>
                <th className="px-4 py-3">Viewings</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((l) => (
                <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`${detailBase}/${l.id}`} className="font-medium text-belize-navy hover:text-belize-blue">
                      {l.title}
                    </Link>
                    <p className="text-xs text-slate-400">{l.reference}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatPrice(l.priceMinor, { purpose: l.purpose, rentalPeriod: l.rentalPeriod })}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={l.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{l.enquiryCount ?? 0}</td>
                  <td className="px-4 py-3 text-slate-600">{l.viewingCount ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active ? 'bg-belize-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

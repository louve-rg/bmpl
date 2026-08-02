'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TERMINAL_VIEWING_STATUSES } from '@bmpl/shared';
import { type ApiError } from '../../../../lib/api';
import {
  realEstateApi,
  fmtDate,
  viewingStatusLabel,
  type ViewingCard,
} from '../../../../lib/realestate';
import { VIEWING_STATUS_TONE } from '../../../../components/realestate/status';
import { Alert, Badge, Button, ButtonLink, EmptyState, PageHeader, Spinner } from '../../../../components/ui';

export default function MyViewingsPage() {
  const [items, setItems] = useState<ViewingCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await realEstateApi.seeker.viewings());
      setError(null);
    } catch (e) {
      setError((e as ApiError).message ?? 'Failed to load viewing requests.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string) {
    setAction(null);
    setBusy(id);
    try {
      await realEstateApi.seeker.cancelViewing(id);
      await load();
    } catch (e) {
      setAction((e as ApiError).message ?? 'Could not cancel.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Real Estate" title="My viewings" description="Viewing requests you've made and their status." />

      {error && <Alert tone="error">{error}</Alert>}
      {action && <Alert tone="error">{action}</Alert>}

      {items === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState
          title="No viewing requests yet"
          description="Request a viewing from any property page."
          action={<ButtonLink href="/properties">Browse properties</ButtonLink>}
        />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">Confirmed</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items?.map((v) => {
                const terminal = TERMINAL_VIEWING_STATUSES.includes(v.status);
                return (
                  <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/properties/${v.listing.slug}`} className="font-medium text-belize-navy hover:text-belize-blue">
                        {v.listing.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {fmtDate(v.requestedDate)}
                      {v.requestedTime ? ` · ${v.requestedTime}` : ''}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {v.confirmedDate ? `${fmtDate(v.confirmedDate)}${v.confirmedTime ? ` · ${v.confirmedTime}` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={VIEWING_STATUS_TONE[v.status]}>{viewingStatusLabel(v.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!terminal && (
                        <Button size="sm" variant="ghost" disabled={busy === v.id} onClick={() => cancel(v.id)}>
                          {busy === v.id ? 'Cancelling…' : 'Cancel'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

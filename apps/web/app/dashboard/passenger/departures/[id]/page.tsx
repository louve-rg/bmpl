'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, type ApiError } from '../../../../../lib/api';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '../../../../../components/ui';
import { errMessage } from '../../../../../components/driver/dashboard-data';
import { DepartureCard } from '../../../../../components/travel/DeparturesList';
import { StopsList } from '../../../../../components/travel/StopsList';
import { riderAccessView, type DepartureDetail } from '../../../../../lib/passenger-travel';

/**
 * One departure, with the route's ordered stops — the information a person
 * waiting at an intermediate stop NEEDS: does this departure serve them?
 *
 * The header card is the same DepartureCard the list renders, so the fare
 * gate, the seats copy and the booking flow exist exactly once. A 404 is
 * shown as not-available, not as an error: the server answers 404 for
 * anything the list would hide (the other side of the simulation boundary,
 * an inactive service, a departure that already left) exactly as it does for
 * an id that never existed — an id is not a probe, and this page must not
 * treat the two differently.
 */
export default function DepartureDetailPage() {
  const params = useParams<{ id: string }>();
  const [row, setRow] = useState<DepartureDetail | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  const reload = useCallback(async () => {
    try {
      setRow(await api.get<DepartureDetail>(`/passenger/departures/${params.id}`));
      setErr(null);
    } catch (e) {
      setErr(e as ApiError);
    }
  }, [params.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex flex-wrap items-center gap-1.5 text-slate-500">
          <li>
            <Link
              href="/dashboard/passenger"
              className="font-medium text-belize-blue transition hover:text-belize-deep hover:underline"
            >
              Passenger Service
            </Link>
          </li>
          <li aria-hidden className="text-slate-300">
            /
          </li>
          <li aria-current="page" className="min-w-0 truncate font-medium text-slate-600">
            Departure
          </li>
        </ol>
      </nav>

      {err ? (
        <DepartureLoadFailure err={err} />
      ) : !row ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : (
        <>
          <PageHeader title={row.route.name} description={`${row.route.originCity} → ${row.route.destinationCity}`} />
          <DepartureCard departure={row} onBooked={reload} />
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-bold text-belize-navy">Stops, in order</h2>
            <StopsList stops={row.route.stops} />
          </Card>
        </>
      )}
    </div>
  );
}

function DepartureLoadFailure({ err }: { err: ApiError }) {
  if (err.status === 404) {
    // Not-available-to-you, indistinguishable from nonexistent — by design.
    return (
      <EmptyState
        title="This departure isn't available"
        description="It may have already left, stopped taking requests, or the link may be wrong."
        action={
          <Link href="/dashboard/passenger" className="text-sm font-semibold text-belize-blue hover:underline">
            Back to departures
          </Link>
        }
      />
    );
  }
  const view = riderAccessView(err.status, errMessage(err));
  return view.kind === 'restricted' ? (
    <EmptyState title={view.title} description={view.detail} />
  ) : (
    <Alert tone="error">{view.detail}</Alert>
  );
}

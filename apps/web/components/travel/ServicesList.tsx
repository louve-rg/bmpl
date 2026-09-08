'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../lib/api';
import { Alert, Card as UiCard, EmptyState, Spinner } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { formatBzd } from '../../lib/passenger-operator';
import { riderAccessView, type PassengerService } from '../../lib/passenger-travel';
import { StopsList } from './StopsList';

/**
 * The services that exist at all — what runs, where it stops, and whether it
 * is priced yet, even when nothing is scheduled. This answers the question an
 * empty departures list cannot: "is this road served at all?"
 *
 * This screen is discovery only: there is deliberately NO booking control on
 * it. Booking belongs to a concrete departure, behind the fare gate the
 * departures screen already enforces. An unpriced service is still shown —
 * fareConfigured false is the pricing-unavailable state — with the plain
 * reason where a fare would be, and never a placeholder price.
 */
export function ServicesList() {
  const [rows, setRows] = useState<PassengerService[] | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get<PassengerService[]>('/passenger/services')
      .then(setRows)
      .catch((e) => setErr(e as ApiError));
  }, []);

  if (err) {
    const view = riderAccessView(err.status, errMessage(err));
    return view.kind === 'restricted' ? (
      <EmptyState title={view.title} description={view.detail} />
    ) : (
      <Alert tone="error">{view.detail}</Alert>
    );
  }
  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No services yet"
        description="When an operator describes a passenger service, it appears here — even before anything is scheduled on it."
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((s) => (
        <ServiceCard key={s.id} service={s} />
      ))}
    </div>
  );
}

function ServiceCard({ service: s }: { service: PassengerService }) {
  const [stopsOpen, setStopsOpen] = useState(false);

  return (
    <UiCard className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm text-belize-navy">{s.name}</b>
        {s.operator && <span className="text-xs text-slate-500">{s.operator}</span>}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {s.originCity} → {s.destinationCity}
        {s.durationMinutes != null ? ` · ~${s.durationMinutes} min` : ''}
      </p>
      {s.scheduleNote && <p className="mt-0.5 text-xs text-slate-500">{s.scheduleNote}</p>}
      {s.description && <p className="mt-1 text-sm text-slate-600">{s.description}</p>}

      {s.fareConfigured && s.baseFareMinor != null ? (
        <p className="mt-1 text-sm text-slate-700">Fare {formatBzd(s.baseFareMinor)}</p>
      ) : (
        // The fare gate's state, stated plainly — a service may exist unpriced,
        // and nothing on this screen books anything anyway.
        <p className="mt-1 text-sm font-medium text-amber-700">
          Not bookable yet — the operator hasn&rsquo;t published a fare for this service.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {s.stops.length > 0 && (
          <button
            type="button"
            className="text-sm font-semibold text-belize-blue hover:underline"
            onClick={() => setStopsOpen((v) => !v)}
          >
            {stopsOpen ? 'Hide stops' : `Stops (${s.stops.length})`}
          </button>
        )}
        <Link href="/dashboard/passenger" className="text-sm font-semibold text-belize-blue hover:underline">
          See upcoming departures
        </Link>
      </div>

      {stopsOpen && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <StopsList stops={s.stops} />
        </div>
      )}
    </UiCard>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DRIVER_DELIVERY_VIEWS, DRIVER_VIEW_DESCRIPTIONS, DRIVER_VIEW_LABELS, type DriverDeliveryView } from '@bmpl/shared';
import { api, type ApiError } from '../../../../lib/api';
import { Alert, Card, EmptyState, PageHeader, Spinner, StatusBadge } from '../../../../components/ui';
import { DeliveryQueue } from '../../../../components/driver/DeliveryQueue';
import { DriverBreadcrumb } from '../../../../components/driver/DriverBreadcrumb';

/* --------------------------------------------------------------- helpers */

function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}
function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}
function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* --------------------------------------------------------------- types */

interface JobSummary {
  id: string;
  status: string;
  statusLabel: string;
  view: DriverDeliveryView | null;
  orderNumber: string;
  vendor: string;
  pickupArea: string | null;
  itemCount: number;
  city: string | null;
  district: string | null;
  feeMinor: number;
  assignedAt: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  offerExpiresAt: string | null;
  queuePosition: number | null;
}

type Counts = Record<DriverDeliveryView, number>;

/* ----------------------------------------------------------------- page */

/**
 * My Deliveries — Available / Assigned / Active / Completed.
 *
 * The four views the client asked for are a presentation mapping over the
 * existing delivery state machine, computed on the server (`driverViewForStatus`
 * in @bmpl/shared) so this page and the API cannot disagree about what "Active"
 * means. No delivery status was added or reinterpreted to produce them, and
 * dispatch is untouched — in particular, "Available" means "offered to YOU and
 * awaiting your answer", not a marketplace of other drivers' work.
 *
 * The queue panel sits above the tabs because a route spans Assigned and Active:
 * a driver with two jobs is deciding between them, not filtering.
 */
export default function DriverJobsPage() {
  const [view, setView] = useState<DriverDeliveryView>('assigned');
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCounts = useCallback(async () => {
    try {
      setCounts(await api.get<Counts>('/driver/jobs/counts'));
    } catch {
      /* badges are best-effort — the lists below are the real content */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<JobSummary[]>(`/driver/jobs?scope=${view}`)
      .then((d) => {
        if (!cancelled) setJobs(d ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(errMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  const refresh = useCallback(() => {
    void loadCounts();
    api
      .get<JobSummary[]>(`/driver/jobs?scope=${view}`)
      .then((d) => setJobs(d ?? []))
      .catch(() => {
        /* the queue below already reported the failure */
      });
  }, [loadCounts, view]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <DriverBreadcrumb current="My Deliveries" />
      <PageHeader title="My Deliveries" description="Everything offered to you, assigned to you, and on the road." />

      {/* The route across all open work — shown only when there is more than one
          job to sequence (the component returns null otherwise). */}
      <DeliveryQueue onChanged={refresh} />

      {/* Horizontally scrollable at 320px rather than wrapping into two rows or
          squeezing four labels into an unreadable width. */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div
          className="inline-flex min-w-full overflow-hidden rounded-bmpl-md border border-slate-200"
          role="tablist"
          aria-label="Filter deliveries"
        >
          {DRIVER_DELIVERY_VIEWS.map((v, i) => {
            const active = view === v;
            const count = counts?.[v] ?? 0;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="driver-jobs-panel"
                onClick={() => setView(v)}
                className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-sm font-semibold transition ${
                  i > 0 ? 'border-l border-slate-200' : ''
                } ${active ? 'bg-belize-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {DRIVER_VIEW_LABELS[v]}
                {count > 0 && (
                  <span
                    className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-[18px] ${
                      active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-sm text-slate-500">{DRIVER_VIEW_DESCRIPTIONS[view]}</p>

      {error && <Alert tone="error">{error}</Alert>}

      <div id="driver-jobs-panel" role="tabpanel">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState title={EMPTY[view].title} description={EMPTY[view].description} />
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li key={job.id}>
                <JobCard job={job} view={view} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const EMPTY: Record<DriverDeliveryView, { title: string; description: string }> = {
  available: {
    title: 'No offers right now',
    description: 'Go online and stay in your service areas — new offers appear here the moment dispatch sends you one.',
  },
  assigned: {
    title: 'Nothing waiting to be collected',
    description: 'Deliveries you accept appear here until you pick them up from the store.',
  },
  active: { title: 'Nothing on the road', description: 'Deliveries you’ve collected appear here until they’re dropped off.' },
  completed: { title: 'No completed deliveries', description: 'Deliveries you complete will appear here.' },
};

function JobCard({ job, view }: { job: JobSummary; view: DriverDeliveryView }) {
  const destination = [job.city, job.district?.replace(/_/g, ' ')].filter(Boolean).join(', ');
  return (
    <Link href={`/dashboard/driver/jobs/${job.id}`} className="block">
      <Card
        className={`p-4 transition hover:border-belize-blue/40 hover:shadow-bmpl-md active:scale-[0.995] sm:p-5 ${
          view === 'available' ? 'border-belize-accent/40 bg-belize-accent/5' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-sm text-belize-navy">Order #{job.orderNumber}</b>
              <StatusBadge status={job.status} />
            </div>
            {/* break-words, not truncate: a long business name on a 320px screen
                should wrap rather than become "Aurora Tro…". */}
            <p className="mt-1 break-words text-sm text-slate-600">{job.vendor}</p>
            <p className="mt-0.5 break-words text-sm text-slate-500">
              {job.itemCount} {job.itemCount === 1 ? 'item' : 'items'}
              {destination ? ` · to ${destination}` : ''}
            </p>
            {job.pickupArea && <p className="mt-0.5 break-words text-xs text-slate-400">Collect from {job.pickupArea}</p>}
            <p className="mt-1 text-xs text-slate-400">
              {view === 'completed' && job.deliveredAt
                ? `Delivered ${formatDate(job.deliveredAt)}`
                : view === 'available' && job.offerExpiresAt
                  ? `Offer expires ${formatDate(job.offerExpiresAt)}`
                  : job.acceptedAt
                    ? `Accepted ${formatDate(job.acceptedAt)}`
                    : job.assignedAt
                      ? `Offered ${formatDate(job.assignedAt)}`
                      : null}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-base font-bold tabular-nums text-belize-navy">{money(job.feeMinor)}</p>
            <p className="mt-0.5 text-xs text-slate-400">fee</p>
          </div>
        </div>
      </Card>
    </Link>
  );
}

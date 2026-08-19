'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DRIVER_DELIVERY_VIEWS,
  DRIVER_VIEW_DESCRIPTIONS,
  DRIVER_VIEW_LABELS,
  isShipmentJob,
  type DriverDeliveryView,
  type DriverJobKind,
} from '@bmpl/shared';
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

/**
 * One job, whatever it came from.
 *
 * The normalized half (`kind`, `pickup`, `dropoff`, `load`, `reference`) works
 * for every job. The marketplace fields below it are the original contract and
 * are still populated for marketplace work — kept so nothing that reads them
 * breaks, not because a shipping job has an order number.
 */
interface JobSummary {
  id: string;
  kind: DriverJobKind;
  kindLabel: string;
  reference: string;
  pickup: { name: string | null; area: string | null };
  dropoff: { name: string | null; area: string | null };
  load: string;
  status: string;
  statusLabel: string;
  view: DriverDeliveryView | null;
  feeMinor: number;
  assignedAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  offerExpiresAt: string | null;
  queuePosition: number | null;
  // ---- marketplace only ----
  orderNumber?: string;
  vendor?: string;
  itemCount?: number;
  deliveredAt?: string | null;
}

/** Shipping legs live on their own detail route; marketplace jobs on theirs. */
const jobHref = (job: JobSummary) =>
  isShipmentJob(job.kind) ? `/dashboard/driver/shipping/${job.id}` : `/dashboard/driver/jobs/${job.id}`;

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
  // Null until the counts say which tab is worth opening — see below.
  const [view, setView] = useState<DriverDeliveryView | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Once the driver picks a tab themselves, never move it under them.
  const chosenByDriver = useRef(false);

  const loadCounts = useCallback(async () => {
    try {
      setCounts(await api.get<Counts>('/driver/jobs/counts'));
    } catch {
      // Badges are best-effort, but the opening tab depends on this. Fall back
      // to Assigned rather than leaving the driver on a spinner.
      setView((v) => v ?? 'assigned');
    }
  }, []);

  /**
   * Open on the first view that actually has work in it.
   *
   * This page used to open on Assigned unconditionally. A driver with two offers
   * waiting and nothing accepted therefore landed on "Nothing waiting to be
   * collected" and concluded there was no work — with the offers sitting one tab
   * to the left, unread. DRIVER_DELIVERY_VIEWS is already ordered by urgency
   * (available → assigned → active → completed), so the first non-empty one is
   * the right place to land.
   */
  useEffect(() => {
    if (chosenByDriver.current || view !== null || !counts) return;
    setView(DRIVER_DELIVERY_VIEWS.find((v) => (counts[v] ?? 0) > 0) ?? 'assigned');
  }, [counts, view]);

  const selectView = useCallback((v: DriverDeliveryView) => {
    chosenByDriver.current = true;
    setView(v);
  }, []);

  useEffect(() => {
    if (view === null) return;
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
    if (view === null) return;
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
                onClick={() => selectView(v)}
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

      {view && <p className="text-sm text-slate-500">{DRIVER_VIEW_DESCRIPTIONS[view]}</p>}

      {error && <Alert tone="error">{error}</Alert>}

      <div id="driver-jobs-panel" role="tabpanel">
        {view === null || loading ? (
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
  const shipping = isShipmentJob(job.kind);
  // A parcel leg names both ends; a marketplace job names the store and an area.
  const from = job.pickup.name ?? job.pickup.area;
  const to = job.dropoff.name ?? job.dropoff.area;
  return (
    <Link href={jobHref(job)} className="block">
      <Card
        className={`p-4 transition hover:border-belize-blue/40 hover:shadow-bmpl-md active:scale-[0.995] sm:p-5 ${
          view === 'available' ? 'border-belize-accent/40 bg-belize-accent/5' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* What KIND of job, before anything else. A driver glancing at a
                  list needs to know whether this is a store run or a parcel leg
                  before they read a single address. */}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                  shipping ? 'bg-belize-accent/15 text-belize-deep' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {job.kindLabel}
              </span>
              <StatusBadge status={job.status} />
            </div>

            <p className="mt-1.5 break-words text-sm font-semibold text-belize-navy">
              {shipping ? job.reference : `Order #${job.orderNumber}`}
            </p>

            {/* Both ends on their own lines. On a 320px screen a single
                "A → B" line wraps in the middle of an address and reads as one
                place; two labelled lines never do. */}
            <p className="mt-1 break-words text-sm text-slate-600">
              <span className="text-slate-400">Collect</span> {from ?? '—'}
            </p>
            <p className="mt-0.5 break-words text-sm text-slate-600">
              <span className="text-slate-400">Deliver</span> {to ?? '—'}
            </p>
            <p className="mt-0.5 break-words text-xs text-slate-500">{job.load}</p>

            <p className="mt-1 text-xs text-slate-400">
              {view === 'completed' && job.completedAt
                ? `Completed ${formatDate(job.completedAt)}`
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

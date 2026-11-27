'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { formatWindow } from '../../../../lib/availability-window';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner, StatusBadge } from '../../../../components/ui';
import { DeliveryQueue } from '../../../../components/driver/DeliveryQueue';
import { DriverBreadcrumb } from '../../../../components/driver/DriverBreadcrumb';

/* --------------------------------------------------------------- helpers */

function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}
function errStatus(e: unknown): number | undefined {
  return (e as ApiError)?.status;
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
  // kind/availabilityWindows are additive (SHIP-B): optional so a frontend
  // deployed ahead of the API still renders, just without the Terminal tag
  // or the window text.
  //
  // SHIP-B Bug 1 (list): address/phone/pinnedLocation/navigationUrl are the
  // same fields PlaceBlock already renders on the detail page — this list
  // is scoped to one driver's own offered/assigned work (never a shared
  // board), so a shipment leg's own door end reveals address/coordinates
  // from offer time; only name/phone wait for acceptance. Optional/additive,
  // same cross-deploy reasoning as kind above — absent means render exactly
  // as before this field existed (name/area only).
  pickup: {
    name: string | null;
    area: string | null;
    kind?: 'ADDRESS' | 'HUB';
    address?: string | null;
  };
  dropoff: {
    name: string | null;
    area: string | null;
    kind?: 'ADDRESS' | 'HUB';
    address?: string | null;
  };
  availabilityWindows?: Array<{ role: 'SENDER' | 'RECIPIENT'; startTime: string; endTime: string }>;
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
  /**
   * EDW-P3: present only on a post-exhaustion row the server appends to the
   * end of `scope=available`, after the live offers — a live offer never
   * carries this key. The same underlying job also appears on the Unclaimed
   * Jobs page (`/driver/jobs/claimable`); `claimPath` is how to claim it from
   * either place, and is always used as-is rather than branched on `kind` —
   * it already resolves which of the two server routes (delivery or courier
   * leg) applies. `inAvailableJobs`/`youPassed` are the server's own
   * eligibility call, never recomputed here.
   */
  claim?: {
    dispatchExhaustedAt: string | null;
    youPassed: boolean;
    inAvailableJobs: boolean;
    claimPath: string;
  };
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
  const router = useRouter();
  // Null until the counts say which tab is worth opening — see below.
  const [view, setView] = useState<DriverDeliveryView | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Once the driver picks a tab themselves, never move it under them.
  const chosenByDriver = useRef(false);

  // ---- EDW-P3: claiming a post-exhaustion row appended to this list ----
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);
  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }

  /**
   * Same lost-race handling as the Unclaimed Jobs page's own `claim()`: a
   * 409/404 is another driver (or admin, or a fresh automatic offer) having
   * won first, not this driver doing anything wrong, so it reads as a plain
   * notice and the row simply leaves the list rather than an error dialog.
   */
  async function claimJob(job: JobSummary) {
    if (!job.claim) return;
    const title = isShipmentJob(job.kind) ? job.reference : `Order #${job.orderNumber}`;
    setClaimingId(job.id);
    setClaimErrors((m) => {
      const { [job.id]: _dropped, ...rest } = m;
      return rest;
    });
    try {
      const won = await api.post<{ id: string }>(job.claim.claimPath);
      router.push(isShipmentJob(job.kind) ? `/dashboard/driver/shipping/${won.id}` : `/dashboard/driver/jobs/${won.id}`);
    } catch (e) {
      const status = errStatus(e);
      if (status === 409 || status === 404) {
        setJobs((js) => js.filter((j) => j.id !== job.id));
        void loadCounts();
        showNotice(
          status === 409
            ? `${title} is no longer available — it was claimed or reassigned. Removed it from your list.`
            : `${title} is no longer available.`,
        );
      } else {
        setClaimErrors((m) => ({ ...m, [job.id]: errMessage(e) }));
      }
    } finally {
      setClaimingId(null);
    }
  }

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
                      active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'
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

      {view && <p className="text-sm text-[color:var(--bmpl-text-muted)]">{DRIVER_VIEW_DESCRIPTIONS[view]}</p>}

      {notice && <Alert tone="info">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <div id="driver-jobs-panel" role="tabpanel">
        {view === null || loading ? (
          <div className="flex items-center gap-2 text-sm text-[color:var(--bmpl-text-muted)]">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState title={EMPTY[view].title} description={EMPTY[view].description} />
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li key={job.id}>
                <JobCard
                  job={job}
                  view={view}
                  onClaim={claimJob}
                  claimBusy={claimingId === job.id}
                  claimError={claimErrors[job.id] ?? null}
                />
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

/**
 * EDW-P3: an appended post-exhaustion row has no offer in progress — the
 * driver would have to come looking for it on the Unclaimed Jobs page
 * (`/driver/jobs/claimable`), same job, same `claimPath`. Routing this card
 * to the normal job-detail page would 404 (it isn't assigned to this driver
 * yet), so it renders inline instead, same shape as that page's own card.
 */
function JobCard({
  job,
  view,
  onClaim,
  claimBusy,
  claimError,
}: {
  job: JobSummary;
  view: DriverDeliveryView;
  onClaim: (job: JobSummary) => void;
  claimBusy: boolean;
  claimError: string | null;
}) {
  const claimable = view === 'available' && job.claim != null;
  const body = <JobCardBody job={job} view={view} />;

  if (!claimable) {
    return (
      <Link href={jobHref(job)} className="block">
        <Card
          className={`p-4 transition hover:border-belize-blue/40 hover:shadow-bmpl-md active:scale-[0.995] sm:p-5 ${
            view === 'available' ? 'border-belize-accent/40 bg-belize-accent/5' : ''
          }`}
        >
          {body}
        </Card>
      </Link>
    );
  }

  return (
    <Card className="p-4 border-belize-accent/40 bg-belize-accent/5 sm:p-5">
      {body}
      <div className="mt-3 border-t border-[color:var(--bmpl-border-soft)] pt-3">
        {/* Same job, same two places — says so plainly rather than letting a
            driver who checks both tabs conclude there are two openings. */}
        <p className="text-xs text-[color:var(--bmpl-text-faint)]">
          Also listed on{' '}
          <Link href="/dashboard/driver/claimable" className="font-medium text-belize-blue hover:underline">
            Unclaimed Jobs
          </Link>
          .
        </p>
        {claimError && (
          <Alert tone="error" className="mt-2">
            {claimError}
          </Alert>
        )}
        <Button className="mt-2 w-full sm:w-auto" disabled={claimBusy} onClick={() => onClaim(job)}>
          {claimBusy ? <Spinner className="h-4 w-4" /> : 'Claim this job'}
        </Button>
        <p className="mt-2 text-xs text-[color:var(--bmpl-text-faint)]">
          Claiming reserves this job for you. You still confirm it on the next screen before the delivery starts.
        </p>
      </div>
    </Card>
  );
}

function JobCardBody({ job, view }: { job: JobSummary; view: DriverDeliveryView }) {
  const shipping = isShipmentJob(job.kind);
  // A parcel leg names both ends; a marketplace job names the store and an area.
  const from = job.pickup.name ?? job.pickup.area;
  const to = job.dropoff.name ?? job.dropoff.area;
  const pickupWindows = (job.availabilityWindows ?? []).filter((w) => w.role === 'SENDER');
  const dropoffWindows = (job.availabilityWindows ?? []).filter((w) => w.role === 'RECIPIENT');
  return (
    <>
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
              <StatusBadge status={job.status} label={job.statusLabel} />
            </div>

            <p className="mt-1.5 break-words text-sm font-semibold text-[color:var(--bmpl-text)]">
              {shipping ? job.reference : `Order #${job.orderNumber}`}
            </p>

            {/* Both ends on their own lines. On a 320px screen a single
                "A → B" line wraps in the middle of an address and reads as one
                place; two labelled lines never do.
                SHIP-B Bug 1: name ?? area as the primary line, an address
                line when present, and area again underneath only when BOTH
                a name and an area exist (so area is never shown twice) —
                the exact rule PlaceBlock already uses on the detail page. */}
            <p className="mt-1 break-words text-sm text-[color:var(--bmpl-text-muted)]">
              <span className="text-[color:var(--bmpl-text-faint)]">Collect</span> {from ?? '—'}
              {job.pickup.kind === 'HUB' && <span className="text-[color:var(--bmpl-text-faint)]"> · Terminal</span>}
            </p>
            {job.pickup.address && <p className="break-words text-xs text-[color:var(--bmpl-text-faint)]">{job.pickup.address}</p>}
            {job.pickup.area && job.pickup.name && (
              <p className="break-words text-xs text-[color:var(--bmpl-text-faint)]">{job.pickup.area}</p>
            )}
            {pickupWindows.length > 0 && (
              <p className="break-words text-xs text-[color:var(--bmpl-text-faint)]">
                Pickup Window: {pickupWindows.map(formatWindow).join(', ')}
              </p>
            )}
            <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-muted)]">
              <span className="text-[color:var(--bmpl-text-faint)]">Deliver</span> {to ?? '—'}
              {job.dropoff.kind === 'HUB' && <span className="text-[color:var(--bmpl-text-faint)]"> · Terminal</span>}
            </p>
            {job.dropoff.address && <p className="break-words text-xs text-[color:var(--bmpl-text-faint)]">{job.dropoff.address}</p>}
            {job.dropoff.area && job.dropoff.name && (
              <p className="break-words text-xs text-[color:var(--bmpl-text-faint)]">{job.dropoff.area}</p>
            )}
            {dropoffWindows.length > 0 && (
              <p className="break-words text-xs text-[color:var(--bmpl-text-faint)]">
                Delivery Window: {dropoffWindows.map(formatWindow).join(', ')}
              </p>
            )}
            <p className="mt-0.5 break-words text-xs text-[color:var(--bmpl-text-muted)]">{job.load}</p>

            <p className="mt-1 text-xs text-[color:var(--bmpl-text-faint)]">
              {job.claim
                ? job.claim.dispatchExhaustedAt
                  ? `Waiting since ${formatDate(job.claim.dispatchExhaustedAt)}`
                  : null
                : view === 'completed' && job.completedAt
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
            <p className="text-base font-bold tabular-nums text-[color:var(--bmpl-text)]">{money(job.feeMinor)}</p>
            <p className="mt-0.5 text-xs text-[color:var(--bmpl-text-faint)]">fee</p>
          </div>
        </div>
    </>
  );
}

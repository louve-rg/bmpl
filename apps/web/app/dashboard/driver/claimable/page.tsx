'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isShipmentJob, type DriverJobKind } from '@bmpl/shared';
import { api, type ApiError } from '../../../../lib/api';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner } from '../../../../components/ui';
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
function districtLabel(d?: string | null): string {
  return d ? d.replace(/_/g, ' ') : '';
}

/* --------------------------------------------------------------- types */

/**
 * `DriverJobService.summarizeClaimable`'s own shape (apps/api/src/dispatch/
 * driver-jobs.service.ts). EDW-P3 extended this from marketplace-only to
 * BOTH marketplace deliveries and shipment courier legs, so the marketplace
 * fields (`orderNumber`/`vendor`/`itemCount`/`city`/`district`) stay exactly
 * as they were — kept beside the new normalized ones, never replaced — and
 * are present only for a marketplace row; a courier-leg row instead carries
 * `kind`/`kindLabel`/`reference`/`pickup`/`dropoff`/`load`, the same
 * vocabulary the Available-list job card already uses.
 */
interface ClaimableJob {
  id: string;
  // ---- marketplace only, unchanged ----
  orderNumber?: string;
  vendor?: string;
  itemCount?: number;
  city?: string | null;
  district?: string | null;
  // ---- courier leg only, new in EDW-P3 ----
  kind?: DriverJobKind;
  kindLabel?: string;
  reference?: string;
  pickup?: { area: string | null };
  dropoff?: { area: string | null };
  load?: string;
  // ---- both ----
  feeMinor: number;
  /**
   * `inAvailableJobs` is the server's own eligibility call — today it equals
   * `!youPassed`, but that is never recomputed here. When true, this exact
   * job also shows on `/dashboard/driver/jobs` (Available tab); the card
   * says so, so a driver checking both tabs sees one job, not two.
   * `claimPath` is always posted as-is rather than branched on kind — it
   * already resolves which of the two server routes applies.
   */
  claim: {
    dispatchExhaustedAt: string | null;
    youPassed: boolean;
    inAvailableJobs: boolean;
    claimPath: string;
  };
}

/* ----------------------------------------------------------------- page */

/**
 * P4-CLAIM: a real surface for `GET /driver/jobs/claimable` and
 * `POST /driver/jobs/:id/claim` (MDF-18) — both existed, permissioned
 * server-side, with no caller anywhere in the web app until this page.
 *
 * Deliberately separate from /dashboard/driver/jobs rather than a fifth tab
 * there: `DRIVER_DELIVERY_VIEWS` is a closed, shared tuple the API and that
 * page both key off of, and this list is a different kind of thing — a pull,
 * not a push. A driver has to come looking for stuck work, same as the API
 * comment on `claimableJobs` says; it is never merged into the offer feed.
 */
export default function ClaimableJobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ClaimableJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.get<ClaimableJob[]>('/driver/jobs/claimable');
      setJobs(d ?? []);
    } catch (e) {
      setError(errMessage(e));
      setJobs((j) => j ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
   * The lost-race case (MDF-18's own `claim()`: a 409 means a concurrent
   * claim, a fresh automatic offer, or an admin assignment won the same
   * conditional write first) is not this driver doing anything wrong, so it
   * never renders as an error dialog — the job simply leaves the list with a
   * plain-language explanation, same tone as a job that quietly disappears
   * because another driver already has it. A 404 (reassigned, cancelled, or
   * raced away between list and claim) reads the same way. Anything else
   * (ineligible, no vehicle, already at the concurrent-job cap) is a real
   * reason specific to this job, so it stays in the list with the server's
   * own message attached to that card.
   */
  async function claim(job: ClaimableJob) {
    const title = job.orderNumber ? `Order #${job.orderNumber}` : job.reference ?? 'This job';
    setClaimingId(job.id);
    setFieldErrors((m) => {
      const { [job.id]: _dropped, ...rest } = m;
      return rest;
    });
    try {
      // Always `claim.claimPath`, never a path built from `job.id` — it
      // already resolves which of the two server routes (delivery or
      // courier leg) this particular job needs.
      const won = await api.post<{ id: string }>(job.claim.claimPath);
      router.push(job.kind && isShipmentJob(job.kind) ? `/dashboard/driver/shipping/${won.id}` : `/dashboard/driver/jobs/${won.id}`);
    } catch (e) {
      const status = errStatus(e);
      if (status === 409 || status === 404) {
        setJobs((js) => (js ?? []).filter((j) => j.id !== job.id));
        showNotice(
          status === 409
            ? `${title} is no longer available — it was claimed or reassigned. Removed it from your list.`
            : `${title} is no longer available.`,
        );
      } else {
        setFieldErrors((m) => ({ ...m, [job.id]: errMessage(e) }));
      }
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <DriverBreadcrumb current="Unclaimed Jobs" />
      <PageHeader
        title="Unclaimed Jobs"
        description="Deliveries automatic dispatch has already given up on, narrowed to the ones you qualify for. Claim one before another driver does."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      {notice && <Alert tone="info">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {jobs === null ? (
        <div className="flex items-center gap-2 text-sm text-[color:var(--bmpl-text-muted)]">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No unclaimed jobs right now"
          description="Jobs appear here only once automatic dispatch has given up on them and you qualify to take them. Check back later."
        />
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <JobCard job={job} busy={claimingId === job.id} error={fieldErrors[job.id] ?? null} onClaim={() => void claim(job)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JobCard({ job, busy, error, onClaim }: { job: ClaimableJob; busy: boolean; error: string | null; onClaim: () => void }) {
  // A marketplace row always carries orderNumber; a courier-leg row never
  // does — that single existing field is enough to tell the two apart
  // without a new discriminant.
  const marketplace = job.orderNumber != null;
  const destination = [job.city, districtLabel(job.district)].filter(Boolean).join(', ');
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {!marketplace && job.kindLabel && (
            <span className="mb-1.5 inline-block rounded-full bg-belize-accent/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-belize-deep">
              {job.kindLabel}
            </span>
          )}
          <p className="break-words text-sm font-semibold text-[color:var(--bmpl-text)]">
            {marketplace ? `Order #${job.orderNumber}` : job.reference}
          </p>
          {marketplace ? (
            <>
              <p className="mt-1.5 break-words text-sm text-[color:var(--bmpl-text-muted)]">
                <span className="text-[color:var(--bmpl-text-faint)]">Collect from</span> {job.vendor}
              </p>
              <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-muted)]">
                <span className="text-[color:var(--bmpl-text-faint)]">Deliver to</span> {destination || '—'}
              </p>
              <p className="mt-0.5 text-xs text-[color:var(--bmpl-text-faint)]">
                {job.itemCount} item{job.itemCount === 1 ? '' : 's'}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1.5 break-words text-sm text-[color:var(--bmpl-text-muted)]">
                <span className="text-[color:var(--bmpl-text-faint)]">Collect</span> {job.pickup?.area ?? '—'}
              </p>
              <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-muted)]">
                <span className="text-[color:var(--bmpl-text-faint)]">Deliver</span> {job.dropoff?.area ?? '—'}
              </p>
              {job.load && <p className="mt-0.5 text-xs text-[color:var(--bmpl-text-faint)]">{job.load}</p>}
            </>
          )}
          {job.claim.dispatchExhaustedAt && (
            <p className="mt-1 text-xs text-[color:var(--bmpl-text-faint)]">Waiting since {formatDate(job.claim.dispatchExhaustedAt)}</p>
          )}
          {job.claim.inAvailableJobs && (
            <p className="mt-1 text-xs text-[color:var(--bmpl-text-faint)]">
              Also showing in your{' '}
              <Link href="/dashboard/driver/jobs" className="font-medium text-belize-blue hover:underline">
                Available
              </Link>{' '}
              tab.
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-bold tabular-nums text-[color:var(--bmpl-text)]">{money(job.feeMinor)}</p>
          <p className="mt-0.5 text-xs text-[color:var(--bmpl-text-faint)]">fee</p>
        </div>
      </div>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      <Button className="mt-3 w-full sm:w-auto" disabled={busy} onClick={onClaim}>
        {busy ? <Spinner className="h-4 w-4" /> : 'Claim this job'}
      </Button>
      <p className="mt-2 text-xs text-[color:var(--bmpl-text-faint)]">
        Claiming reserves this job for you. You still confirm it on the next screen before the delivery starts.
      </p>
    </Card>
  );
}

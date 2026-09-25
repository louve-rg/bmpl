'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, type ApiError } from '../../../../../lib/api';
import { tripMapPoints } from '../../../../../lib/trip-map';
import { Alert, Button, Card, PageHeader, Spinner, StatusBadge } from '../../../../../components/ui';
import { DriverBreadcrumb } from '../../../../../components/driver/DriverBreadcrumb';
import { ExpandableRouteMap } from '../../../../../components/maps/ExpandableRouteMap';

/**
 * One shipment courier leg, from the driver's side.
 *
 * Deliberately the same shape as the marketplace job screen — two blocks, "1 ·
 * Collect from" and "2 · Deliver to", a navigate button on each, then one
 * primary action. A driver switching between a store run and a parcel leg should
 * not have to relearn the page; only the words inside it change.
 */

interface Place {
  kind: 'ADDRESS' | 'HUB';
  name: string | null;
  phone: string | null;
  address: string | null;
  area: string | null;
  instructions: string | null;
  navigationUrl: string | null;
  /** Sent for a terminal end always, for a door end only after acceptance. */
  pinnedLocation?: { latitude: number; longitude: number } | null;
}

interface ShippingJob {
  id: string;
  jobKind: 'FIRST_MILE' | 'LAST_MILE';
  reference: string;
  status: string;
  statusLabel: string;
  nextActionLabel: string | null;
  modeLabel: string;
  addressUnlocked: boolean;
  pickup: Place | null;
  dropoff: Place | null;
  parcel: { description: string | null; pieces: number; weightGrams: number | null };
  feeMinor: number;
  handoffCodeHeldBy: string;
  offerExpiresAt: string | null;
  pinAttemptsRemaining: number;
}

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const errMessage = (e: unknown) => (e as ApiError)?.message ?? 'Something went wrong.';

/** Which endpoint the primary button posts to, given where the job is. */
function actionFor(status: string): { path: string; needsCode?: boolean } | null {
  switch (status) {
    case 'ASSIGNED':
      return { path: 'accept' };
    case 'DRIVER_ACCEPTED':
      return { path: 'pickup' };
    case 'PICKUP_CONFIRMED':
      return { path: 'in-transit' };
    case 'IN_TRANSIT':
      return { path: 'arriving' };
    case 'ARRIVING':
      return { path: 'handoff', needsCode: true };
    default:
      return null;
  }
}

function PlaceBlock({ step, label, place, locked }: { step: number; label: string; place: Place | null; locked: boolean }) {
  if (!place) return null;
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {step} · {label}
      </p>
      <p className="mt-1 break-words text-base font-semibold text-belize-navy">{place.name ?? place.area ?? '—'}</p>
      {place.address && <p className="mt-0.5 break-words text-sm text-slate-600">{place.address}</p>}
      {place.area && place.name && <p className="mt-0.5 break-words text-sm text-slate-500">{place.area}</p>}

      {place.instructions && (
        <p className="mt-2 rounded-bmpl-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{place.instructions}</p>
      )}

      {locked && place.kind === 'ADDRESS' && (
        // Said plainly rather than shown as an error. The driver has not done
        // anything wrong; they simply have not taken the job yet.
        <p className="mt-2 text-sm text-slate-500">The full address and phone number appear once you accept.</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {place.navigationUrl && (
          <a
            href={place.navigationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center rounded-bmpl-md bg-belize-blue px-4 text-sm font-semibold text-white"
          >
            Navigate
          </a>
        )}
        {place.phone && (
          <a
            href={`tel:${place.phone}`}
            className="inline-flex min-h-[44px] items-center rounded-bmpl-md border border-slate-300 px-4 text-sm font-semibold text-belize-navy"
          >
            Call
          </a>
        )}
      </div>
    </Card>
  );
}

export default function DriverShippingJobPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params.id ?? '');

  const [job, setJob] = useState<ShippingJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [receivedBy, setReceivedBy] = useState('');

  const load = useCallback(async () => {
    try {
      setJob(await api.get<ShippingJob>(`/driver/shipping-jobs/${id}`));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).status === 404 ? 'This job is no longer yours.' : errMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const action = job ? actionFor(job.status) : null;

  async function run() {
    if (!job || !action) return;
    setBusy(true);
    setErr(null);
    try {
      const body = action.needsCode ? { pin: code.trim(), receivedByName: receivedBy.trim() } : {};
      await api.post(`/driver/shipping-jobs/${job.id}/${action.path}`, body);
      setCode('');
      await load();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    if (!job) return;
    const reason = window.prompt('Why are you passing on this job?')?.trim();
    if (!reason || reason.length < 3) return;
    setBusy(true);
    try {
      await api.post(`/driver/shipping-jobs/${job.id}/decline`, { reason });
      router.push('/dashboard/driver/jobs');
    } catch (e) {
      setErr(errMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <DriverBreadcrumb current="Shipping job" />

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}
      {err && (
        <Alert tone="warning" className="mt-4">
          {err}
        </Alert>
      )}

      {job && (
        <>
          <PageHeader
            title={job.jobKind === 'FIRST_MILE' ? 'Shipping pickup' : 'Shipping delivery'}
            description={`${job.reference} · ${job.modeLabel} leg`}
          />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} />
            <span className="text-sm font-semibold tabular-nums text-belize-navy">{money(job.feeMinor)}</span>
          </div>

          <div className="mt-4 space-y-3">
            <PlaceBlock step={1} label="Collect from" place={job.pickup} locked={!job.addressUnlocked} />
            <PlaceBlock step={2} label="Deliver to" place={job.dropoff} locked={!job.addressUnlocked} />

            {/* The map draws only the pins the server sent: a terminal is a
                public place and arrives pinned before acceptance; a door end
                stays area-only until the driver commits (BMPL-136). Stops are
                lettered A, B… in order, with an expand control for a
                full-screen view (BMPL-182) — still behind a tap so the tiles
                never load for a driver on data who just wants the words. */}
            {(() => {
              const points = tripMapPoints(job.pickup, job.dropoff);
              if (points.length === 0) return null;
              return (
                <Card className="p-4 sm:p-5">
                  <ExpandableRouteMap points={points} title={`${job.reference} · route`} />
                  {points.length < 2 && !job.addressUnlocked && (
                    <p className="mt-2 text-xs text-slate-500">The other end shows its area above until you accept.</p>
                  )}
                </Card>
              );
            })()}

            <Card className="p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What you are moving</p>
              <p className="mt-1 break-words text-sm text-slate-700">
                {job.parcel.description || `${job.parcel.pieces} ${job.parcel.pieces === 1 ? 'parcel' : 'parcels'}`}
              </p>
              {job.parcel.weightGrams != null && (
                <p className="mt-0.5 text-sm text-slate-500">About {(job.parcel.weightGrams / 453.6).toFixed(1)} lb</p>
              )}
            </Card>
          </div>

          {/* The handoff code. Told up front, not at the counter — the driver
              needs to know who to ask before they arrive. */}
          {action?.needsCode && (
            <Card className="mt-3 p-4 sm:p-5">
              <p className="text-sm font-semibold text-belize-navy">Finish the handover</p>
              <p className="mt-1 text-sm text-slate-600">
                Ask {job.handoffCodeHeldBy} for the code and enter it here.
              </p>
              <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="code">
                Handover code
              </label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 w-full rounded-bmpl-md border border-slate-300 px-3 py-3 text-lg tracking-[0.3em]"
                placeholder="0000"
              />
              <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="who">
                Who took it
              </label>
              <input
                id="who"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                className="mt-1 w-full rounded-bmpl-md border border-slate-300 px-3 py-3 text-base"
                placeholder="Name of the person receiving it"
              />
              {job.pinAttemptsRemaining < 5 && (
                <p className="mt-2 text-xs text-amber-700">
                  {job.pinAttemptsRemaining} {job.pinAttemptsRemaining === 1 ? 'try' : 'tries'} left before this needs an
                  administrator.
                </p>
              )}
            </Card>
          )}

          {/* One primary action, full width, thumb-height. */}
          <div className="sticky bottom-0 mt-4 space-y-2 bg-white/95 py-3 backdrop-blur">
            {action && (
              <Button onClick={run} disabled={busy} className="min-h-[48px] w-full text-base">
                {busy ? 'Working…' : (job.nextActionLabel ?? 'Continue')}
              </Button>
            )}
            {job.status === 'ASSIGNED' && (
              <button
                onClick={decline}
                disabled={busy}
                className="min-h-[44px] w-full rounded-bmpl-md border border-slate-300 text-sm font-semibold text-slate-600"
              >
                Pass on this job
              </button>
            )}
            {!action && (
              <Link
                href="/dashboard/driver/jobs"
                className="flex min-h-[44px] w-full items-center justify-center rounded-bmpl-md border border-slate-300 text-sm font-semibold text-belize-navy"
              >
                Back to my deliveries
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}

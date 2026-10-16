'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, type ApiError } from '../../../../../lib/api';
import { tripMapPoints } from '../../../../../lib/trip-map';
import { uploadFile } from '../../../../../lib/uploads';
import { isExceptionBlocked, pickupPhotoSection, reportIssueState } from '../../../../../lib/driver-shipping-job';
import { Alert, Badge, Button, Card, Label, PageHeader, Spinner, StatusBadge } from '../../../../../components/ui';
import { DriverBreadcrumb } from '../../../../../components/driver/DriverBreadcrumb';
import { ExpandableRouteMap } from '../../../../../components/maps/ExpandableRouteMap';

/**
 * One shipment courier leg, from the driver's side.
 *
 * Deliberately the same shape as the marketplace job screen — two blocks, "1 ·
 * Collect from" and "2 · Deliver to", a navigate button on each, then one
 * primary action. A driver switching between a store run and a parcel leg should
 * not have to relearn the page; only the words inside it change.
 *
 * REPORT AN ISSUE (MDF-96 / Edward req 10): POST
 * /driver/shipping-jobs/:id/report-issue (apps/api/src/shipping/
 * driver-shipping.controller.ts) already existed, worked, and was correctly
 * restricted server-side to a leg the parcel is actually held on
 * (PICKUP_CONFIRMED/IN_TRANSIT/ARRIVING) — but had zero references anywhere
 * in apps/web, same shape as the order-cancel affordance earlier tonight.
 * This is the button.
 *
 * KNOWN LIMITATION, stated here rather than silently worked around: the
 * confirmation shown after a successful report (`reportedReason` below) is
 * client-side only and does not survive a page reload. The driver job view
 * (ShipmentDriverService#serialize) returns `courierStatus` only — never the
 * leg's separate `status`/`exceptionReason`/`exceptionAt` fields that
 * `flagException` actually writes server-side, so there is currently no
 * field this page could read back to reconstruct "a report is already in"
 * after a fresh load. That is an apps/api read-side gap (an additive field
 * on an existing response, not a new endpoint), out of scope for this
 * apps/web-only change — flagged to the team rather than crossed silently.
 *
 * EXCEPTION BLOCKS PROGRESSION (owner ruling, god conv-mission-2026-10-13):
 * an active delivery exception blocks further courier progression until
 * authorized staff resolve it. apps/api owns the actual guard on the
 * transition endpoints; this screen's job is only to stop offering a control
 * the API is about to refuse, and say why — see `isExceptionBlocked` in
 * lib/driver-shipping-job.ts for the `legStatus` field this reads (additive,
 * degrades to today's unblocked behaviour while absent). No timeframe or
 * promise about what happens next is stated.
 *
 * RESOLVED 2026-10-14 (reconciling this PR against that one): Report an
 * issue is one of the controls EXCEPTION blocks, not an exception to the
 * rule — `report-issue` calls `flagException`, which is routed through
 * `transition()`, whose first gate (`isLegActionable`,
 * packages/shared/src/shipping.ts) refuses any leg already in EXCEPTION.
 * Offering the button while blocked would be offering a control the server
 * is certain to refuse — exactly what the EXCEPTION-blocks-progression rule
 * exists to stop. The gap noted above (the courier status machine's own
 * accept/pickup/in-transit/arriving transitions having no EXCEPTION check)
 * is now closed by that same gate for THIS action; whether it is closed for
 * the primary action too lives in `isExceptionBlocked`, not here.
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
  /**
   * The whole known journey, sender door to recipient door — not just this
   * leg's two ends (BMPL-190). Optional: web and api deploy independently
   * (BMPL-349/350) — a real window on every merge where this field hasn't
   * started arriving yet. Absence degrades the same as an empty array: no
   * map renders, same as any shipment with no locatable stop today.
   */
  routeStops?: Place[];
  parcel: { description: string | null; pieces: number; weightGrams: number | null };
  feeMinor: number;
  handoffCodeHeldBy: string;
  offerExpiresAt: string | null;
  pinAttemptsRemaining: number;
  /**
   * BMPL-178/352 (Edward req 2): pickup evidence already attached to THIS
   * leg. Optional — web and api deploy independently, and a required field
   * read unguarded is how a screen crashes on the api side lagging behind a
   * merge (BMPL-349); absence means nothing attached yet, same as empty.
   */
  pickupPhotoUrls?: string[];
  /**
   * The shipment layer's own view of this leg (PENDING/READY/IN_PROGRESS/
   * EXCEPTION) — distinct from `status` above, which is the driver's
   * `courierStatus` view of the same row. Optional/additive: see
   * `isExceptionBlocked` in lib/driver-shipping-job.ts.
   */
  legStatus?: string | null;
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
      <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bmpl-text-muted)]">
        {step} · {label}
      </p>
      <p className="mt-1 break-words text-base font-semibold text-[color:var(--bmpl-text)]">{place.name ?? place.area ?? '—'}</p>
      {place.address && <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-muted)]">{place.address}</p>}
      {place.area && place.name && <p className="mt-0.5 break-words text-sm text-[color:var(--bmpl-text-muted)]">{place.area}</p>}

      {place.instructions && (
        <p className="mt-2 rounded-bmpl-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{place.instructions}</p>
      )}

      {locked && place.kind === 'ADDRESS' && (
        // Said plainly rather than shown as an error. The driver has not done
        // anything wrong; they simply have not taken the job yet.
        <p className="mt-2 text-sm text-[color:var(--bmpl-text-muted)]">The full address and phone number appear once you accept.</p>
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
            className="inline-flex min-h-[44px] items-center rounded-bmpl-md border border-[color:var(--bmpl-border)] px-4 text-sm font-semibold text-[color:var(--bmpl-text)]"
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
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [reportedReason, setReportedReason] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

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

  const blocked = job ? isExceptionBlocked(job) : false;
  const action = job && !blocked ? actionFor(job.status) : null;
  const photoSection = job ? pickupPhotoSection(job, action !== null) : 'hidden';
  const reportState = job ? reportIssueState(job.status, reportedReason !== null) : 'unavailable';

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

  /**
   * BMPL-178/352 (Edward req 2): pickup-evidence photo, server-side upload
   * then attach — two independent calls, not bundled into the main action
   * (unlike the marketplace delivery form's podPhotoKeys, which rides the
   * SAME confirm-delivery POST). `confirmPickupPhoto` REPLACES
   * `handoffPhotoKeys` wholesale on every call — it does not merge with
   * what is already stored — and the read side only ever returns signed
   * URLs, never the underlying keys, so there is no way to recover a
   * PRIOR session's keys to include them here. Resending every key added
   * IN THIS SESSION on each call (not just the newest one) is what keeps
   * a second photo from silently overwriting the first; this control is
   * offered only while nothing is attached yet (see the render below) so
   * a session that starts with existing evidence can never reach a
   * confirm call that would wipe it.
   */
  async function addPhoto(file: File) {
    if (!job) return;
    setPhotoBusy(true);
    setErr(null);
    try {
      const key = await uploadFile(`/driver/shipping-jobs/${job.id}/pickup-photo/upload`, file);
      const keys = [...photoKeys, key];
      const updated = await api.post<ShippingJob>(`/driver/shipping-jobs/${job.id}/pickup-photo/confirm`, { photoKeys: keys });
      setPhotoKeys(keys);
      setJob(updated);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setPhotoBusy(false);
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

  /**
   * MDF-96 / Edward req 10. Mirrors decline()'s window.prompt shape — the
   * one reason-collecting action already on this page — rather than
   * introducing a new form pattern for a single field. The endpoint accepts
   * free text only (packages/validation/src/shipping.ts legExceptionSchema,
   * 4-500 chars) — no reason codes to pick from, so none are invented here.
   */
  async function reportIssue() {
    if (!job) return;
    const reason = window.prompt('What went wrong? (at least 4 characters)')?.trim();
    if (!reason || reason.length < 4) return;
    setReportBusy(true);
    setErr(null);
    try {
      await api.post(`/driver/shipping-jobs/${job.id}/report-issue`, { reason });
      setReportedReason(reason);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setReportBusy(false);
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
                stays area-only until the driver commits (BMPL-136). Stops span
                the WHOLE shipment — sender door, every real hub it actually
                routes through, recipient door (BMPL-190) — not just this
                leg's own two ends, so a first-mile driver can see there's a
                hub-to-hub hop ahead even though only their own end unlocks.
                Lettered A, B… in order, with an expand control for a
                full-screen view (BMPL-182) — still behind a tap so the tiles
                never load for a driver on data who just wants the words. */}
            {(() => {
              const routeStops = job.routeStops ?? [];
              const points = tripMapPoints(routeStops);
              if (points.length === 0) return null;
              return (
                <Card className="p-4 sm:p-5">
                  <ExpandableRouteMap points={points} title={`${job.reference} · route`} />
                  {points.length < routeStops.length && !job.addressUnlocked && (
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

            {/* BMPL-178/352 (Edward req 2): evidence you actually picked this
                parcel up for your own leg — sender and staff see the same
                photo on their own screens. Shown only once you've accepted
                (nothing to photograph at a door you haven't unlocked), and
                the "add" control only while nothing is attached yet — see
                addPhoto's own comment for why a second upload session
                cannot safely add to a first. */}
            {photoSection !== 'hidden' && (
              <Card className="p-4 sm:p-5">
                <Label>Pickup photo</Label>
                {photoSection === 'existing' ? (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {(job.pickupPhotoUrls ?? []).map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={url}
                        alt={`Pickup photo ${i + 1}`}
                        className="h-20 w-20 rounded-bmpl-md border border-slate-200 object-cover"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {photoKeys.map((k) => (
                      <Badge key={k} tone="success">
                        Photo added
                      </Badge>
                    ))}
                    <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-[color:var(--bmpl-border)] px-3 py-1.5 text-sm font-semibold text-[color:var(--bmpl-text)] transition hover:border-belize-blue hover:bg-belize-blue/5">
                      {photoBusy ? <Spinner className="h-4 w-4" /> : 'Add photo'}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        disabled={photoBusy}
                        onChange={(e) => e.target.files?.[0] && void addPhoto(e.target.files[0])}
                      />
                    </label>
                  </div>
                )}
                <p className="mt-1 text-xs text-slate-400">Optional</p>
              </Card>
            )}
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

          {/* Reported this session (checked first: it's this driver's own,
              fresher-than-a-reload knowledge of why) -- this screen stops
              offering a further movement action, but that is THIS SCREEN's
              own choice, not a backend guarantee. Copy must not claim more
              than the system actually does: "on hold" was corrected to
              what flagException actually guarantees (the team is
              notified, a human reviews it) after god caught it as the
              same class of overclaim #385's gate exists to catch. Neutral
              copy only: no refund, fee or timeframe promised either,
              since the endpoint makes none. */}
          {reportState === 'reported' && (
            <Alert tone="warning" title="Issue reported" className="mt-4">
              “{reportedReason}” — our team has been notified and will review it.
            </Alert>
          )}

          {/* Owner ruling (god, conv-mission-2026-10-13): say why nothing can
              move, with no timeframe or promise about what happens next —
              the backend guard (apps/api) is what actually enforces the
              hold; this is only the explanation. Skipped when reportState
              is 'reported': that banner above already explains it, and is
              this driver's own fresher account of why. */}
          {blocked && reportState !== 'reported' && (
            <Alert tone="warning" title="This leg has an open issue" className="mt-4">
              Nothing can move forward until our team resolves it.
            </Alert>
          )}

          {/* One primary action, full width, thumb-height. */}
          <div className="sticky bottom-0 mt-4 space-y-2 bg-white/95 py-3 backdrop-blur">
            {reportState !== 'reported' && action && (
              <Button onClick={run} disabled={busy} className="min-h-[48px] w-full text-base">
                {busy ? 'Working…' : (job.nextActionLabel ?? 'Continue')}
              </Button>
            )}
            {reportState !== 'reported' && job.status === 'ASSIGNED' && (
              <button
                onClick={decline}
                disabled={busy}
                className="min-h-[44px] w-full rounded-bmpl-md border border-[color:var(--bmpl-border)] text-sm font-semibold text-[color:var(--bmpl-text-muted)]"
              >
                Pass on this job
              </button>
            )}
            {reportState === 'available' && !blocked && (
              <button
                onClick={reportIssue}
                disabled={reportBusy}
                className="min-h-[44px] w-full rounded-bmpl-md border border-slate-300 text-sm font-semibold text-red-600"
              >
                {reportBusy ? 'Working…' : 'Report an issue'}
              </button>
            )}
            {(!action || reportState === 'reported') && (
              <Link
                href="/dashboard/driver/jobs"
                className="flex min-h-[44px] w-full items-center justify-center rounded-bmpl-md border border-[color:var(--bmpl-border)] text-sm font-semibold text-[color:var(--bmpl-text)]"
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

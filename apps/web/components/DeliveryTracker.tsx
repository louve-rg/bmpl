'use client';

import { useEffect, useState } from 'react';
import { money } from '../lib/cart';
import {
  deliveriesApi,
  DELIVERY_STEPS,
  isDelivered,
  type CustomerDeliveryDetail,
  type DeliveryDriver,
  type DeliveryProof,
  type DeliveryTimelineEvent,
  type DeliveryVehicle,
} from '../lib/deliveries';
import type { DeliveryEstimate } from '../lib/orders';
import type { ApiError } from '../lib/api';
import { deliveryStatusDisplay } from '../lib/delivery-stage';
import { Alert, Button, Spinner, StatusBadge } from './ui';
import { Avatar } from './Avatar';

/* ------------------------------------------------------------ shared bits */

/** Vertical stepper across the canonical delivery journey. Any stage already
 *  reached (per the timeline) or at/under the current status index is marked
 *  done; steps that don't match the live enum simply stay upcoming. */
export function DeliveryStepper({
  status,
  timeline,
}: {
  status: string;
  timeline: DeliveryTimelineEvent[];
}) {
  const reached = new Set<string>([status, ...timeline.map((t) => t.toStatus)]);
  const currentIndex = DELIVERY_STEPS.findIndex((s) => s.key === status);

  return (
    <ol className="relative">
      {DELIVERY_STEPS.map((step, i) => {
        const done = reached.has(step.key) || (currentIndex >= 0 && i < currentIndex);
        const current = step.key === status;
        const last = i === DELIVERY_STEPS.length - 1;
        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                  current
                    ? 'border-belize-blue bg-belize-blue'
                    : done
                      ? 'border-emerald-500 bg-emerald-500'
                      : 'border-slate-300 bg-white'
                }`}
              />
              {!last && (
                <span className={`w-0.5 flex-1 ${done ? 'bg-emerald-500' : 'bg-slate-200'}`} style={{ minHeight: 18 }} />
              )}
            </div>
            <span
              className={`pb-3 text-sm ${
                current ? 'font-semibold text-belize-navy' : done ? 'text-slate-600' : 'text-slate-400'
              }`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Actual recorded event history (authoritative). */
export function DeliveryEventLog({ timeline }: { timeline: DeliveryTimelineEvent[] }) {
  if (timeline.length === 0) return null;
  return (
    <div>
      <p className="bmpl-label mb-2">History</p>
      <ul className="space-y-2">
        {[...timeline]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map((t, i) => (
            <li key={i} className="text-xs text-slate-500">
              <span className="font-medium text-slate-700">{t.toStatus.replace(/_/g, ' ')}</span>
              {t.actorRole ? <span> · {t.actorRole.toLowerCase()}</span> : null}
              <span> · {new Date(t.createdAt).toLocaleString()}</span>
              {t.note ? <p className="text-slate-400">{t.note}</p> : null}
            </li>
          ))}
      </ul>
    </div>
  );
}

export function DriverCard({ driver, vehicle }: { driver: DeliveryDriver | null; vehicle: DeliveryVehicle | null }) {
  if (!driver && !vehicle) return null;
  const vehicleSummary = vehicle
    ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ') ||
      vehicle.type ||
      null
    : null;
  return (
    <div className="flex items-center gap-3 rounded-bmpl-md border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm">
      {driver && (
        <Avatar
          name={driver.displayName}
          src={driver.avatarUrl}
          initials={driver.initials}
          size="md"
        />
      )}
      <div className="min-w-0">
        {driver && (
          <p className="font-medium text-belize-navy">
            {driver.displayName}
            {driver.ratingAverage != null && (
              <span className="ml-2 font-normal text-slate-500">★ {driver.ratingAverage.toFixed(1)}</span>
            )}
            {driver.completedDeliveries != null && (
              <span className="ml-2 font-normal text-slate-400">· {driver.completedDeliveries} deliveries</span>
            )}
          </p>
        )}
        {vehicle && (
          <p className="mt-0.5 text-slate-500">
            {vehicleSummary}
            {vehicle.licencePlate ? ` · ${vehicle.licencePlate}` : ''}
          </p>
        )}
      </div>
      {/* Vehicle photo, when the vehicle itself has cleared review (BMPL-180).
          A broken/expired signed URL degrades to nothing, never a broken-image
          icon next to someone's door code. */}
      {vehicle?.photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={vehicle.photoUrl}
          alt=""
          className="ml-auto h-12 w-16 shrink-0 rounded-bmpl-md object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
    </div>
  );
}

export function ProofOfDelivery({ proof }: { proof: DeliveryProof }) {
  return (
    <div className="rounded-bmpl-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <p className="text-sm font-semibold text-emerald-800">Delivered</p>
      <p className="mt-0.5 text-xs text-emerald-700">
        {proof.recipientName ? `Received by ${proof.recipientName}` : 'Recipient not recorded'}
        {proof.deliveredAt ? ` · ${new Date(proof.deliveredAt).toLocaleString()}` : ''}
      </p>
      {proof.podPhotoUrls.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {proof.podPhotoUrls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={url}
              alt={`Proof of delivery ${i + 1}`}
              className="h-16 w-16 rounded-bmpl-md border border-emerald-200 object-cover"
            />
          ))}
        </div>
      )}
    </div>
  );
}

function estimateText(estimate: DeliveryEstimate | null): string | null {
  if (!estimate) return null;
  return estimate.label ?? `${estimate.minHours}–${estimate.maxHours} h`;
}

/* -------------------------------------------------- customer PIN reveal */

function DeliveryCodeReveal({ deliveryId }: { deliveryId: string }) {
  const [pin, setPin] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setErr(null);
    try {
      const res = await deliveriesApi.pin(deliveryId);
      if (res.verificationStatus === 'VERIFIED') {
        setVerified(true);
        setPin(null);
      } else {
        setPin(res.deliveryPin);
      }
    } catch {
      setErr('Could not load your delivery code.');
    } finally {
      setBusy(false);
    }
  }

  if (verified) {
    return <p className="text-xs font-medium text-emerald-700">Delivery code verified.</p>;
  }

  return (
    <div>
      {pin ? (
        <div>
          <p className="font-mono text-2xl font-bold tracking-[0.3em] text-belize-navy">{pin}</p>
          <p className="mt-1 text-xs text-slate-500">Share this code with your driver on arrival.</p>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={reveal} disabled={busy}>
          {busy ? 'Loading…' : 'Show delivery code'}
        </Button>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------- main view */

export function DeliveryTracker({ deliveryId }: { deliveryId: string }) {
  const [data, setData] = useState<CustomerDeliveryDetail | null>(null);
  const [proof, setProof] = useState<DeliveryProof | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    deliveriesApi
      .get(deliveryId)
      .then((d) => {
        if (!active) return;
        setData(d);
        setState('ready');
        if (isDelivered(d.status)) {
          deliveriesApi
            .proof(deliveryId)
            .then((p) => active && setProof(p))
            .catch(() => active && setProof(null));
        }
      })
      .catch((e) => {
        if (!active) return;
        setState((e as ApiError).status === 404 ? 'ready' : 'error');
      });
    return () => {
      active = false;
    };
  }, [deliveryId]);

  return (
    <div className="border-t border-slate-100 px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="bmpl-label">Delivery tracking</p>
        {data && <StatusBadge status={data.status} />}
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading tracking…
        </div>
      )}
      {state === 'error' && <Alert tone="warning">Couldn’t load delivery tracking right now.</Alert>}

      {state === 'ready' && data && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-belize-navy">
            {/* Prefer the pre-dispatch stage sentence when the API names one
                (BMPL-128/129) — statusLabel says "Awaiting driver" from the
                moment of checkout, before the store has even packed. The rule
                lives once in lib/delivery-stage.ts; do not restate it here. */}
            {(() => {
              const display = deliveryStatusDisplay(data);
              return display.kind === 'stage' ? display.label : data.statusLabel;
            })()}
            {estimateText(data.estimate) && (
              <span className="ml-2 font-normal text-slate-500">· Est. {estimateText(data.estimate)}</span>
            )}
          </p>

          <DriverCard driver={data.driver} vehicle={data.vehicle} />

          <DeliveryStepper status={data.status} timeline={data.timeline} />

          {!isDelivered(data.status) && <DeliveryCodeReveal deliveryId={deliveryId} />}

          {proof && <ProofOfDelivery proof={proof} />}

          <DeliveryEventLog timeline={data.timeline} />

          <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
            <a
              href="mailto:support@bzemarketplace.com?subject=Delivery%20help"
              className="text-xs font-medium text-belize-blue hover:underline"
            >
              Contact support
            </a>
            <span className="text-xs text-slate-400">for help with this delivery</span>
          </div>
        </div>
      )}
    </div>
  );
}

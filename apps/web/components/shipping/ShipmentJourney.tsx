'use client';

import {
  formatTransitTime,
  headlineFor,
  legPhase,
  shippingMoney,
  type ShipmentLegView,
  type ShipmentView,
} from '../../lib/shipping';

/**
 * One journey, told once.
 *
 * A parcel going Placencia → San Pedro is a collection, a flight, and a
 * delivery, and the customer paid for all three at once. So the headline is a
 * single status and the price is a single number; the legs sit underneath as an
 * explanation, not as something to reason about. A parcel resting at an airstrip
 * overnight is much easier to accept when you can see why it is there.
 *
 * Built to be read on a phone held in one hand — the stepper is a vertical rail,
 * not a horizontal one that would either overflow or shrink into illegibility at
 * 320px.
 */

const MODE_ICON: Record<string, string> = { LAND: '🚚', AIR: '✈️', SEA: '⛴️' };

function LegRow({ leg, isLast }: { leg: ShipmentLegView; isLast: boolean }) {
  const phase = legPhase(leg);
  const dot =
    phase === 'done'
      ? 'bg-emerald-500 border-emerald-500'
      : phase === 'current'
        ? 'bg-white border-belize-blue ring-4 ring-belize-blue/15'
        : phase === 'stopped'
          ? 'bg-amber-500 border-amber-500'
          : 'bg-white border-slate-300';

  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {/* The rail. Drawn behind the dot so a completed leg reads as one line. */}
      {!isLast && (
        <span
          aria-hidden
          className={`absolute left-[7px] top-4 bottom-0 w-0.5 ${phase === 'done' ? 'bg-emerald-400' : 'bg-slate-200'}`}
        />
      )}
      <span aria-hidden className={`relative mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${dot}`} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-base leading-none" aria-hidden>
            {MODE_ICON[leg.mode] ?? '📦'}
          </span>
          <p className={`text-sm font-medium ${phase === 'upcoming' ? 'text-slate-500' : 'text-slate-900'}`}>
            {leg.description ?? leg.modeLabel}
          </p>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {leg.carrier && <span>with {leg.carrier}</span>}
          {formatTransitTime(leg.durationMinutes) && <span>about {formatTransitTime(leg.durationMinutes)}</span>}
          {leg.scheduleNote && <span>{leg.scheduleNote}</span>}
        </div>

        {/* What actually happened, once it has. */}
        {leg.completedAt && leg.handoffReceivedByName && (
          <p className="mt-1 text-xs text-emerald-700">Handed over to {leg.handoffReceivedByName}</p>
        )}
        {leg.exceptionReason && (
          <p className="mt-1 rounded-bmpl-md bg-amber-50 px-2 py-1 text-xs text-amber-800">{leg.exceptionReason}</p>
        )}
        {leg.destinationHub?.instructions && phase === 'current' && (
          <p className="mt-1 text-xs text-slate-600">{leg.destinationHub.instructions}</p>
        )}
      </div>
    </li>
  );
}

export function ShipmentJourney({ shipment }: { shipment: ShipmentView }) {
  const doorCode = shipment.legs.find((l) => l.handoffPin)?.handoffPin ?? null;
  const collectHub = shipment.status === 'AWAITING_COLLECTION'
    ? [...shipment.legs].reverse().find((l) => l.destinationHub)?.destinationHub ?? null
    : null;

  return (
    <div className="space-y-4">
      {/* One status, one price. Everything else is explanation. */}
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
        <p className="text-xs uppercase tracking-wide text-slate-500">{shipment.reference}</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">{headlineFor(shipment)}</h2>
        {shipment.explanation && <p className="mt-2 text-sm text-slate-600">{shipment.explanation}</p>}

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Total</dt>
            <dd className="font-semibold text-slate-900">{shippingMoney(shipment.quotedTotalMinor)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Service</dt>
            <dd className="text-slate-900">{shipment.serviceLabel}</dd>
          </div>
        </dl>
      </div>

      {/* The door code. Shown only on a shipment that ends at an address, and
          only while it is still on its way — after that it is just a stale
          number somebody might read out to the wrong person. */}
      {doorCode && (
        <div className="rounded-bmpl-xl border border-belize-blue/30 bg-belize-blue/5 p-4">
          <p className="text-sm font-medium text-slate-900">Your delivery code</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-belize-blue">{doorCode}</p>
          <p className="mt-2 text-xs text-slate-600">
            Give this to the driver when they hand the parcel over. Nobody else needs it.
          </p>
        </div>
      )}

      {collectHub && (
        <div className="rounded-bmpl-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Ready to collect</p>
          <p className="mt-1 break-words text-base font-semibold text-emerald-900">{collectHub.name}</p>
          {collectHub.city && <p className="mt-0.5 break-words text-sm text-emerald-800">{collectHub.city}</p>}
          {collectHub.instructions && (
            // Opening hours and which counter, as the operator configured them.
            // A parcel "ready to collect" from a place you cannot find is not
            // ready for anything.
            <p className="mt-2 break-words text-sm text-emerald-800">{collectHub.instructions}</p>
          )}
          {collectHub.latitude != null && collectHub.longitude != null && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${collectHub.latitude},${collectHub.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-[44px] items-center rounded-bmpl-md bg-emerald-700 px-4 text-sm font-semibold text-white"
            >
              Directions
            </a>
          )}
        </div>
      )}

      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
        <h3 className="text-sm font-semibold text-slate-900">The journey</h3>
        <ol className="mt-4">
          {shipment.legs.map((leg, i) => (
            <LegRow key={leg.id} leg={leg} isLast={i === shipment.legs.length - 1} />
          ))}
        </ol>
      </div>

      {shipment.custody.length > 0 && (
        <details className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
          {/* Collapsed by default: most people want the headline, and the ones
              who want the full chain really want it. */}
          {/* min-h-11: measured at 20px in the mobile pass, which is half a
              thumb. The flex wrapper keeps the text vertically centred in the
              taller target rather than pinned to the top of it. */}
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-slate-900">
            Who has handled it ({shipment.custody.length})
          </summary>
          <ul className="mt-3 space-y-2 text-xs text-slate-600">
            {shipment.custody.map((c) => (
              <li key={c.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-800">{c.actorLabel ?? c.toHolder.toLowerCase()}</span>
                <span>{c.note}</span>
                <time dateTime={c.occurredAt} className="text-slate-400">
                  {new Date(c.occurredAt).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

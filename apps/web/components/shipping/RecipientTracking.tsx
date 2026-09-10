'use client';

import type { RecipientTrackingView } from '../../lib/shipping';
import { destinationLine, recipientHeadline, stepTone } from '../../lib/recipient-tracking';

/**
 * The recipient's public view of a parcel on its way to them.
 *
 * Deliberately NOT {@link ShipmentJourney}: that screen shows money, the door
 * code, and the full custody chain — all of which the recipient payload
 * withholds on purpose. This renders only what the API hands a person holding a
 * shared link: reference, a status headline, the service, the destination town,
 * the collection terminal while (and only while) the parcel waits there, and the
 * step progress in customer language.
 */

const MODE_ICON: Record<string, string> = { Road: '🚚', Air: '✈️', Sea: '⛴️' };

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' });
}

export function RecipientTracking({ view }: { view: RecipientTrackingView }) {
  const town = destinationLine(view);

  return (
    <div className="space-y-4">
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
        <p className="text-xs uppercase tracking-wide text-slate-500">{view.reference}</p>
        <h1 className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">{recipientHeadline(view)}</h1>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Service</dt>
            <dd className="text-slate-900">{view.serviceLabel}</dd>
          </div>
          {town && (
            <div>
              <dt className="text-xs text-slate-500">Going to</dt>
              <dd className="text-slate-900">{town}</dd>
            </div>
          )}
        </dl>

        {view.deliveredAt && (
          <p className="mt-3 text-sm text-emerald-700">Delivered {formatDate(view.deliveredAt)}</p>
        )}
      </div>

      {/* The collection terminal, shown only while the parcel is waiting there. */}
      {view.collectionHub && (
        <div className="rounded-bmpl-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Ready to collect</p>
          <p className="mt-1 break-words text-base font-semibold text-emerald-900">{view.collectionHub.name}</p>
          <p className="mt-0.5 break-words text-sm text-emerald-800">{view.collectionHub.city}</p>
          {view.collectionHub.address && (
            <p className="mt-0.5 break-words text-sm text-emerald-800">{view.collectionHub.address}</p>
          )}
          {view.collectionHub.instructions && (
            <p className="mt-2 break-words text-sm text-emerald-800">{view.collectionHub.instructions}</p>
          )}
        </div>
      )}

      {view.steps.length > 0 && (
        <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
          <h2 className="text-sm font-semibold text-slate-900">The journey</h2>
          <ol className="mt-4">
            {view.steps.map((step, i) => {
              const tone = stepTone(step);
              const dot =
                tone === 'done'
                  ? 'bg-emerald-500 border-emerald-500'
                  : tone === 'current'
                    ? 'bg-white border-belize-blue ring-4 ring-belize-blue/15'
                    : 'bg-white border-slate-300';
              return (
                <li key={step.sequence} className="relative flex gap-3 pb-6 last:pb-0">
                  {i < view.steps.length - 1 && (
                    <span
                      aria-hidden
                      className={`absolute left-[7px] top-4 bottom-0 w-0.5 ${tone === 'done' ? 'bg-emerald-400' : 'bg-slate-200'}`}
                    />
                  )}
                  <span aria-hidden className={`relative mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-base leading-none" aria-hidden>
                        {MODE_ICON[step.modeLabel] ?? '📦'}
                      </span>
                      <p className={`text-sm font-medium ${tone === 'upcoming' ? 'text-slate-500' : 'text-slate-900'}`}>
                        {step.description}
                      </p>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{step.kindLabel}</span>
                      {step.completedAt && <span>{formatDate(step.completedAt)}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

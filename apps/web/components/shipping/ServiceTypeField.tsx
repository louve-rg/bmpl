'use client';

import { useEffect, useRef, useState } from 'react';
import { SHIPPING_SERVICES, SHIPPING_SERVICE_LABELS, type ShippingService } from '@bmpl/shared';

/**
 * Choosing how far BML carries the parcel.
 *
 * A select rather than four cards: the four options are one decision with one
 * answer, and four large tiles push the rest of the form — the addresses, the
 * price — below the fold on a phone for a choice most people make in a second.
 *
 * The explanation lives behind an info button instead of under every option,
 * because it is long, it is read once, and inlining it would restore exactly the
 * bulk the select removed.
 */

/**
 * Customer-facing wording. "Hub" is used deliberately: a hub may be an airport,
 * an airstrip, a water taxi terminal, a warehouse or a depot, and naming the
 * category is clearer than naming whichever one happens to serve their town.
 */
const EXPLANATIONS: Record<ShippingService, string> = {
  DOOR_TO_DOOR:
    'We collect the shipment from the pickup address and deliver it to the final destination. If air, sea or hub transfers are required, BML coordinates those steps as part of the same shipment.',
  DOOR_TO_HUB:
    'We collect the shipment from the pickup address and transport it to the selected destination hub, where the recipient can collect it.',
  HUB_TO_HUB:
    'Drop the shipment at the origin hub. BML transports it to the destination hub for collection.',
  HUB_TO_DOOR:
    'Drop the shipment at the origin hub. BML transports it to the destination area and completes delivery to the recipient’s address.',
};

/** The order a customer thinks about them, not the order the enum declares. */
const ORDER: ShippingService[] = ['DOOR_TO_DOOR', 'DOOR_TO_HUB', 'HUB_TO_HUB', 'HUB_TO_DOOR'];

export function ServiceTypeField({
  value,
  onChange,
}: {
  value: ShippingService;
  onChange: (next: ShippingService) => void;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and focus returns to the button that opened it. A dialog you
  // can open but not dismiss from the keyboard is a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label htmlFor="service-type" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Service type
        </label>
        {/* A real button, not a hover tooltip: this has to work on a phone,
            where there is no hover. 44px so a thumb can hit it. */}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="What do these service types mean?"
          aria-haspopup="dialog"
          className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-belize-blue"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <select
        id="service-type"
        value={value}
        onChange={(e) => onChange(e.target.value as ShippingService)}
        className="mt-1 w-full min-h-[48px] rounded-bmpl-md border border-slate-300 bg-white px-3 text-base"
      >
        {ORDER.map((s) => (
          <option key={s} value={s}>
            {SHIPPING_SERVICE_LABELS[s]}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-sm text-slate-600">{EXPLANATIONS[value]}</p>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          {/* A bottom sheet on a phone, a centred dialog on a larger screen —
              the same component, reachable with a thumb either way. */}
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="service-help-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full overflow-y-auto rounded-t-bmpl-xl bg-white p-5 shadow-bmpl-lg sm:max-w-lg sm:rounded-bmpl-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="service-help-title" className="text-base font-semibold text-belize-navy">
                Service types
              </h2>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <p className="mt-1 text-sm text-slate-600">
              A hub is a place a shipment changes hands — an airport, an airstrip, a water taxi terminal, a warehouse
              or a depot.
            </p>

            <dl className="mt-4 space-y-4">
              {ORDER.map((s) => (
                <div key={s} className={s === value ? 'rounded-bmpl-md bg-belize-blue/5 p-3' : 'px-3'}>
                  <dt className="text-sm font-semibold text-belize-navy">
                    {SHIPPING_SERVICE_LABELS[s]}
                    {s === value && <span className="ml-2 text-xs font-normal text-belize-blue">selected</span>}
                  </dt>
                  <dd className="mt-1 text-sm leading-snug text-slate-600">{EXPLANATIONS[s]}</dd>
                </div>
              ))}
            </dl>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="mt-5 min-h-[48px] w-full rounded-bmpl-md bg-belize-blue text-base font-semibold text-white"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { EXPLANATIONS as SERVICE_EXPLANATIONS };
export const SERVICE_ORDER = ORDER;
export const ALL_SERVICES = SHIPPING_SERVICES;

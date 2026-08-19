'use client';

import dynamic from 'next/dynamic';
import { DISTRICTS, DISTRICT_LABELS } from '@bmpl/shared';
import type { ShippingHub } from '../../lib/shipping';

// The map is client-only and heavy; it must not be in the first paint of a form
// most people fill in top-to-bottom.
const LocationPicker = dynamic(() => import('../maps/LocationPicker').then((m) => m.LocationPicker), {
  ssr: false,
  loading: () => <div className="h-[252px] animate-pulse rounded-bmpl-md bg-slate-100" />,
});

export interface EndpointValue {
  mode: 'DOOR' | 'HUB';
  hubId: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  district: string;
  instructions: string;
  latitude: number | null;
  longitude: number | null;
}

export const emptyEndpoint = (): EndpointValue => ({
  mode: 'DOOR',
  hubId: '',
  name: '',
  phone: '',
  address: '',
  city: '',
  district: '',
  instructions: '',
  latitude: null,
  longitude: null,
});

/**
 * One end of a shipment: an address we collect from / deliver to, or a terminal
 * the customer handles themselves.
 *
 * The DOOR / TERMINAL choice is presented first because it changes what the rest
 * of the form even asks for. Showing all the fields at once and disabling half of
 * them would make the customer read a form that mostly does not apply to them.
 *
 * The map is the same Leaflet picker checkout uses — same accuracy wording, same
 * "tap to place a pin", same district-following. A second map implementation
 * would be a second set of bugs and a second thing to keep in step with the
 * Belize bounds the server enforces.
 */
export function EndpointPicker({
  label,
  value,
  onChange,
  hubs,
  allowDoor,
  allowHub,
  contactLabel,
}: {
  label: string;
  value: EndpointValue;
  onChange: (next: EndpointValue) => void;
  hubs: ShippingHub[];
  allowDoor: boolean;
  allowHub: boolean;
  /** "Sender" or "Recipient" — whose details these are. */
  contactLabel: string;
}) {
  const set = <K extends keyof EndpointValue>(key: K, v: EndpointValue[K]) => onChange({ ...value, [key]: v });
  const showDoor = value.mode === 'DOOR';

  return (
    <fieldset className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
      <legend className="px-1 text-sm font-semibold text-belize-navy">{label}</legend>

      {allowDoor && allowHub && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(
            [
              { key: 'DOOR', title: 'An address', hint: 'We come to the door' },
              { key: 'HUB', title: 'A terminal', hint: 'Handled at the counter' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => set('mode', opt.key)}
              aria-pressed={value.mode === opt.key}
              className={`min-h-[56px] rounded-bmpl-md border px-3 py-2 text-left transition ${
                value.mode === opt.key
                  ? 'border-belize-blue bg-belize-blue/5 ring-1 ring-belize-blue'
                  : 'border-slate-300 hover:border-slate-400'
              }`}
            >
              <span className="block text-sm font-semibold text-belize-navy">{opt.title}</span>
              <span className="block text-xs text-slate-500">{opt.hint}</span>
            </button>
          ))}
        </div>
      )}

      {showDoor ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="District" required>
              <select
                value={value.district}
                onChange={(e) => set('district', e.target.value)}
                className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
              >
                <option value="">Choose a district</option>
                {DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {DISTRICT_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Town or village" required>
              <input
                value={value.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="Placencia"
                className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
              />
            </Field>
          </div>

          <Field label="Street address" required>
            <input
              value={value.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="12 Freetown Road"
              className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
            />
          </Field>

          <LocationPicker
            value={value.latitude != null && value.longitude != null ? { latitude: value.latitude, longitude: value.longitude } : null}
            onChange={(next) => onChange({ ...value, latitude: next?.latitude ?? null, longitude: next?.longitude ?? null })}
            address={value.address}
            district={value.district}
            heading="Show us exactly where"
            hint="Many Belize addresses are not on the map. Drop a pin so the driver finds you first time."
          />
        </div>
      ) : (
        <div className="mt-4">
          <Field label="Terminal" required>
            <select
              value={value.hubId}
              onChange={(e) => set('hubId', e.target.value)}
              className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
            >
              <option value="">Choose a terminal</option>
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} · {h.city}
                </option>
              ))}
            </select>
          </Field>
          {/* Whatever the operator configured, shown at the point it matters. */}
          {hubs.find((h) => h.id === value.hubId)?.instructions && (
            <p className="mt-2 rounded-bmpl-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {hubs.find((h) => h.id === value.hubId)!.instructions}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={`${contactLabel} name`} required>
          <input
            value={value.name}
            onChange={(e) => set('name', e.target.value)}
            className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
          />
        </Field>
        <Field label={`${contactLabel} phone`} required>
          <input
            value={value.phone}
            onChange={(e) => set('phone', e.target.value)}
            inputMode="tel"
            placeholder="501-222-3333"
            className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
          />
        </Field>
      </div>

      <Field label="Anything the driver should know">
        <input
          value={value.instructions}
          onChange={(e) => set('instructions', e.target.value)}
          placeholder="Blue gate, ask for Marisol"
          className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
        />
      </Field>
    </fieldset>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  );
}

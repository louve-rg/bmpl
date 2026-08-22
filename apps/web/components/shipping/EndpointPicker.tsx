'use client';

import { AddressField, emptyAddress, type AddressMethod, type AddressValue } from '../address/AddressField';
import type { ShippingHub } from '../../lib/shipping';

export interface EndpointValue {
  mode: 'DOOR' | 'HUB';
  hubId: string;
  /** How the customer chose to give us the address. */
  method: AddressMethod;
  savedAddressId: string | null;
  name: string;
  phone: string;
  email: string;
  company: string;
  address: string;
  addressLine2: string;
  city: string;
  district: string;
  instructions: string;
  latitude: number | null;
  longitude: number | null;
}

export const emptyEndpoint = (): EndpointValue => ({
  mode: 'DOOR',
  hubId: '',
  method: 'TYPED',
  savedAddressId: null,
  name: '',
  phone: '',
  email: '',
  company: '',
  address: '',
  addressLine2: '',
  city: '',
  district: '',
  instructions: '',
  latitude: null,
  longitude: null,
});

/* The two shapes carry the same facts under different names; these keep the
   translation in one place rather than scattered through the component. */
const toAddress = (v: EndpointValue): AddressValue => ({
  ...emptyAddress(v.method),
  method: v.method,
  savedAddressId: v.savedAddressId,
  fullName: v.name,
  phone: v.phone,
  email: v.email,
  company: v.company,
  addressLine1: v.address,
  addressLine2: v.addressLine2,
  city: v.city,
  district: v.district,
  instructions: v.instructions,
  latitude: v.latitude,
  longitude: v.longitude,
});

const fromAddress = (base: EndpointValue, a: AddressValue): EndpointValue => ({
  ...base,
  method: a.method,
  savedAddressId: a.savedAddressId,
  name: a.fullName,
  phone: a.phone,
  email: a.email,
  company: a.company,
  address: a.addressLine1,
  addressLine2: a.addressLine2,
  city: a.city,
  district: a.district,
  instructions: a.instructions,
  latitude: a.latitude,
  longitude: a.longitude,
});

/**
 * One end of a shipment: an address we collect from / deliver to, or a terminal
 * the customer handles themselves.
 *
 * The DOOR / TERMINAL choice comes first because it changes what the rest of the
 * form even asks for. Showing every field at once and disabling half of them
 * would make the customer read a form that mostly does not apply to them.
 *
 * The door case is the shared AddressField — the same component the rest of BML
 * collects addresses with, so pin/typed/saved behave identically wherever a
 * customer meets them, and there is one map implementation to keep correct
 * rather than several that drift.
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
    <div className="space-y-3">
      {allowDoor && allowHub && (
        <fieldset className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
          <legend className="px-1 text-sm font-semibold text-belize-navy">{label}</legend>
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
        </fieldset>
      )}

      {showDoor ? (
        <AddressField
          heading={allowDoor && allowHub ? `${contactLabel} details and address` : label}
          description={`Where we ${contactLabel === 'Sender' ? 'collect' : 'deliver'}, and who to contact.`}
          value={toAddress(value)}
          onChange={(a) => onChange(fromAddress(value, a))}
        />
      ) : (
        <fieldset className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5">
          <legend className="px-1 text-sm font-semibold text-belize-navy">{label}</legend>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Terminal<span className="ml-0.5 text-rose-500">*</span>
            </span>
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
          </label>

          {/* Whatever the operator configured, shown at the point it matters. */}
          {hubs.find((h) => h.id === value.hubId)?.instructions && (
            <p className="mt-2 rounded-bmpl-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {hubs.find((h) => h.id === value.hubId)!.instructions}
            </p>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                {contactLabel} name<span className="ml-0.5 text-rose-500">*</span>
              </span>
              <input
                value={value.name}
                onChange={(e) => set('name', e.target.value)}
                className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                {contactLabel} phone<span className="ml-0.5 text-rose-500">*</span>
              </span>
              <input
                value={value.phone}
                onChange={(e) => set('phone', e.target.value)}
                inputMode="tel"
                placeholder="501-222-3333"
                className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
              />
            </label>
          </div>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Anything the driver should know
            </span>
            <input
              value={value.instructions}
              onChange={(e) => set('instructions', e.target.value)}
              placeholder="Blue gate, ask for Marisol"
              className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base"
            />
          </label>
        </fieldset>
      )}
    </div>
  );
}

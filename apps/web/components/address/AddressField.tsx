'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import dynamic from 'next/dynamic';
import { DISTRICTS, DISTRICT_LABELS, type Coordinates } from '@bmpl/shared';
import {
  addressGap,
  switchMethod,
  toSavedAddressPayload,
  type AddressMethod,
  type AddressValue,
  type ContactLevel,
  type SavedAddress,
} from '../../lib/address';
import { api, type ApiError } from '../../lib/api';
import { Alert, Spinner } from '../ui';

// The map is client-only and heavy. It must not be in the first paint of a form
// most people fill in from the top down.
const LocationPicker = dynamic(() => import('../maps/LocationPicker').then((m) => m.LocationPicker), {
  ssr: false,
  loading: () => <div className="h-[252px] animate-pulse rounded-bmpl-md bg-slate-100" />,
});

export {
  addressGap,
  emptyAddress,
  switchMethod,
  type AddressMethod,
  type AddressValue,
  type ContactLevel,
  type SavedAddress,
} from '../../lib/address';

const METHODS: Array<{ value: AddressMethod; label: string; hint: string }> = [
  { value: 'PIN', label: 'Drop a pin', hint: 'Show us on the map. Best when the address is hard to describe.' },
  { value: 'TYPED', label: 'Type the address', hint: 'We will find it on the map so you can check it.' },
  { value: 'SAVED', label: 'Use a saved address', hint: 'One you have used before.' },
];

/**
 * One end of a delivery or shipment: who to contact, where to go, and the point
 * on the map that a driver will actually navigate to.
 *
 * WHY THE MAP IS ALWAYS HERE. Belize addresses frequently cannot be found from
 * their text — "behind the old bridge" is a real and useless navigation target.
 * So whichever way the customer gives us the address, they finish by looking at
 * a pin and agreeing that it is the right spot. Typing gets geocoded and pinned;
 * a saved address brings its stored pin with it; dropping a pin is the pin. The
 * confirmation step is the same in all three cases because the risk is the same
 * in all three cases: a driver sent to the wrong place.
 *
 * Both the text and the coordinate are kept. They are not substitutes — the text
 * is what a person recognises when they arrive, the pin is what the phone routes
 * to — so neither is derived from the other.
 */
export function AddressField({
  value,
  onChange,
  heading,
  description,
  disabled,
  contact = 'FULL',
  showInstructions = true,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  heading: string;
  description?: string;
  disabled?: boolean;
  /** How much of the contact block to ask for. See ContactLevel. */
  contact?: ContactLevel;
  /**
   * Marketplace checkout collects instructions PER STORE, because two vendors
   * in one order are two separate drops. Two instruction boxes on one page,
   * one of which quietly wins, is how a customer's gate code gets lost.
   */
  showInstructions?: boolean;
}) {
  const uid = useId();
  const [saved, setSaved] = useState<SavedAddress[] | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(false);

  // The star: saving a brand-new address into the book, and editing/removing one
  // already picked from it.
  const [labelDraft, setLabelDraft] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editingAddress, setEditingAddress] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const set = useCallback(
    (patch: Partial<AddressValue>) => onChange({ ...value, ...patch }),
    [onChange, value],
  );

  // Only fetch the address book when the customer actually asks for it.
  useEffect(() => {
    if (value.method !== 'SAVED' || saved !== null || loadingSaved) return;
    setLoadingSaved(true);
    api
      .get<SavedAddress[]>('/addresses')
      .then((rows) => setSaved(rows))
      .catch(() => setSavedError('We could not load your saved addresses just now.'))
      .finally(() => setLoadingSaved(false));
  }, [value.method, saved, loadingSaved]);

  function chooseSaved(id: string) {
    const row = saved?.find((s) => s.id === id);
    if (!row) {
      set({ savedAddressId: null });
      return;
    }
    // Copied INTO the form, not referenced. Adjusting the pin afterwards must
    // not rewrite the address book entry the customer picked.
    set({
      savedAddressId: row.id,
      fullName: row.fullName,
      phone: row.phone,
      email: row.email ?? '',
      company: row.company ?? '',
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2 ?? '',
      city: row.city,
      district: row.district,
      instructions: row.instructions ?? '',
      latitude: row.latitude,
      longitude: row.longitude,
    });
    setEditLabel(row.label);
    setEditError(null);
  }

  function apiErrorMessage(e: unknown, fallback: string): string {
    const err = e as ApiError;
    return err.errors?.[0]?.message ?? err.message ?? fallback;
  }

  // Re-fetches the whole list from the server after any mutation, rather than
  // patching it locally, so the dropdown never shows a partial book (e.g. only
  // the row just created) if the customer had not opened it yet this session.
  async function refreshSaved() {
    try {
      setSaved(await api.get<SavedAddress[]>('/addresses'));
    } catch {
      setSavedError('We could not refresh your saved addresses just now.');
    }
  }

  /**
   * The star affordance. Available the moment an address is complete enough to
   * save — typed, pinned or a mix — not only once it has already been chosen
   * from the dropdown. `savedAddressId` (identity), never the address text, is
   * what decides whether the star is already filled in.
   */
  async function saveToAddressBook() {
    if (!labelDraft.trim()) {
      setSaveError('Name this address — "Home" or "Office" is fine.');
      return;
    }
    setSavingAddress(true);
    setSaveError(null);
    try {
      const created = await api.post<SavedAddress>('/addresses', toSavedAddressPayload(value, labelDraft));
      await refreshSaved();
      set({ savedAddressId: created.id });
      setEditLabel(created.label);
      setLabelDraft('');
    } catch (e) {
      setSaveError(apiErrorMessage(e, 'Could not save this address just now.'));
    } finally {
      setSavingAddress(false);
    }
  }

  /** Pushes the form's current fields back onto the saved entry it came from. */
  async function updateSavedAddress() {
    if (!value.savedAddressId) return;
    if (!editLabel.trim()) {
      setEditError('This address needs a name.');
      return;
    }
    setEditingAddress(true);
    setEditError(null);
    try {
      await api.patch<SavedAddress>(`/addresses/${value.savedAddressId}`, toSavedAddressPayload(value, editLabel));
      await refreshSaved();
    } catch (e) {
      setEditError(apiErrorMessage(e, 'Could not update this address just now.'));
    } finally {
      setEditingAddress(false);
    }
  }

  async function removeSavedAddress() {
    if (!value.savedAddressId) return;
    if (!window.confirm('Remove this address from your saved addresses? This cannot be undone.')) return;
    const id = value.savedAddressId;
    setEditingAddress(true);
    setEditError(null);
    try {
      await api.del(`/addresses/${id}`);
      set({ savedAddressId: null });
      await refreshSaved();
    } catch (e) {
      setEditError(apiErrorMessage(e, 'Could not remove this address just now.'));
    } finally {
      setEditingAddress(false);
    }
  }

  const coords: Coordinates | null =
    value.latitude != null && value.longitude != null ? { latitude: value.latitude, longitude: value.longitude } : null;

  const savedRow = value.savedAddressId ? saved?.find((s) => s.id === value.savedAddressId) : undefined;
  const movedFromSaved =
    savedRow != null &&
    coords != null &&
    (savedRow.latitude !== coords.latitude || savedRow.longitude !== coords.longitude);

  return (
    <fieldset className="rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm sm:p-5" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold text-belize-navy">{heading}</legend>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}

      {/* ---------------------------------------------------- contact */}
      {contact !== 'NONE' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Labelled id={`${uid}-name`} label="Full name" required>
            <input
              id={`${uid}-name`}
              value={value.fullName}
              onChange={(e) => set({ fullName: e.target.value })}
              autoComplete="name"
              className={inputClass}
            />
          </Labelled>
          <Labelled id={`${uid}-phone`} label="Phone" required>
            <input
              id={`${uid}-phone`}
              value={value.phone}
              onChange={(e) => set({ phone: e.target.value })}
              inputMode="tel"
              autoComplete="tel"
              className={inputClass}
            />
          </Labelled>
          {contact === 'FULL' && (
            <>
            <Labelled id={`${uid}-email`} label="Email" optional>
              <input
                id={`${uid}-email`}
                value={value.email}
                onChange={(e) => set({ email: e.target.value })}
                inputMode="email"
                autoComplete="email"
                className={inputClass}
              />
            </Labelled>
            <Labelled id={`${uid}-company`} label="Company" optional>
              <input
                id={`${uid}-company`}
                value={value.company}
                onChange={(e) => set({ company: e.target.value })}
                autoComplete="organization"
                className={inputClass}
              />
            </Labelled>
            </>
          )}
        </div>
      )}

      {/* ----------------------------------------------- address method */}
      <div className="mt-5">
        <label htmlFor={`${uid}-method`} className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          How would you like to give us the address?
        </label>
        <select
          id={`${uid}-method`}
          value={value.method}
          onChange={(e) => onChange(switchMethod(value, e.target.value as AddressMethod))}
          className={`${inputClass} mt-1`}
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">{METHODS.find((m) => m.value === value.method)?.hint}</p>
      </div>

      {/* ------------------------------------------------ saved picker */}
      {value.method === 'SAVED' && (
        <div className="mt-4">
          {loadingSaved && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Loading your addresses…
            </p>
          )}
          {savedError && <Alert tone="warning">{savedError}</Alert>}
          {saved && saved.length === 0 && (
            <Alert tone="info">
              You have not saved any addresses yet. Type the address instead — you can save it afterwards.
            </Alert>
          )}
          {saved && saved.length > 0 && (
            <>
              <label htmlFor={`${uid}-saved`} className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Saved address
              </label>
              <select
                id={`${uid}-saved`}
                value={value.savedAddressId ?? ''}
                onChange={(e) => chooseSaved(e.target.value)}
                className={`${inputClass} mt-1`}
              >
                <option value="">Choose an address…</option>
                {saved.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {s.isDefault ? ' (default)' : ''} — {s.addressLine1}, {s.city}
                  </option>
                ))}
              </select>

              {value.savedAddressId && (
                <div className="mt-3 rounded-bmpl-md border border-slate-200 bg-slate-50 p-3">
                  <Labelled id={`${uid}-edit-label`} label="Label" required>
                    <input
                      id={`${uid}-edit-label`}
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className={inputClass}
                    />
                  </Labelled>
                  <p className="mt-2 text-xs text-slate-500">
                    Editing the fields above changes what this saved address will hold — nothing is written back
                    until you save.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <button
                      type="button"
                      onClick={updateSavedAddress}
                      disabled={editingAddress}
                      className="text-sm font-semibold text-belize-blue hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      {editingAddress ? 'Saving…' : 'Save changes to this address'}
                    </button>
                    <button
                      type="button"
                      onClick={removeSavedAddress}
                      disabled={editingAddress}
                      className="text-sm font-semibold text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      Remove from saved addresses
                    </button>
                  </div>
                  {editError && (
                    <Alert tone="warning" className="mt-2">
                      {editError}
                    </Alert>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ------------------------------------------------ address fields */}
      {value.method !== 'PIN' && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Labelled id={`${uid}-line1`} label="Street name and address" required>
              <input
                id={`${uid}-line1`}
                value={value.addressLine1}
                onChange={(e) => set({ addressLine1: e.target.value })}
                autoComplete="address-line1"
                className={inputClass}
              />
            </Labelled>
          </div>
          <div className="sm:col-span-2">
            <Labelled id={`${uid}-line2`} label="Apartment, suite, landmark" optional>
              <input
                id={`${uid}-line2`}
                value={value.addressLine2}
                onChange={(e) => set({ addressLine2: e.target.value })}
                autoComplete="address-line2"
                className={inputClass}
              />
            </Labelled>
          </div>
          <Labelled id={`${uid}-city`} label="City, town or village" required>
            <input
              id={`${uid}-city`}
              value={value.city}
              onChange={(e) => set({ city: e.target.value })}
              autoComplete="address-level2"
              className={inputClass}
            />
          </Labelled>
          <Labelled id={`${uid}-district`} label="District or island" required>
            <select
              id={`${uid}-district`}
              value={value.district}
              onChange={(e) => set({ district: e.target.value })}
              className={inputClass}
            >
              <option value="">Choose…</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {DISTRICT_LABELS[d]}
                </option>
              ))}
            </select>
          </Labelled>
        </div>
      )}

      {/* PIN mode still asks for the town and the district.
          NOT a fake street address — the pin is the location, and asking for one
          again is exactly what made dropping a pin pointless. But the town and
          district are not location detail: they price the delivery, they decide
          which drivers are matched, and for a shipment the town is what says
          whether one courier can do the whole job or the parcel has to cross
          water. A pin is not allowed to imply them. */}
      {value.method === 'PIN' && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Labelled id={`${uid}-city-pin`} label="City, town or village" required>
            <input
              id={`${uid}-city-pin`}
              value={value.city}
              onChange={(e) => set({ city: e.target.value })}
              autoComplete="address-level2"
              className={inputClass}
            />
          </Labelled>
          <Labelled id={`${uid}-district-pin`} label="District or island" required>
            <select
              id={`${uid}-district-pin`}
              value={value.district}
              onChange={(e) => set({ district: e.target.value })}
              className={inputClass}
            >
              <option value="">Choose…</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {DISTRICT_LABELS[d]}
                </option>
              ))}
            </select>
          </Labelled>
        </div>
      )}

      {/* ------------------------------------------------------- the map */}
      <div className="mt-5">
        <LocationPicker
          value={coords}
          onChange={(next) => set({ latitude: next?.latitude ?? null, longitude: next?.longitude ?? null })}
          address={[value.addressLine1, value.city].filter(Boolean).join(', ')}
          district={value.district}
          heading="Check the location on the map"
          hint={
            value.method === 'PIN'
              ? 'Tap the map to place your pin, then drag it until it is exactly right.'
              : 'This is where we think the address is. Drag the pin if it is not quite right — the pin is what your driver follows.'
          }
          autoLocateAddress={value.method !== 'PIN'}
        />

        {/* In PIN mode the pin IS the address, so its absence is the one thing
            standing between the customer and submitting. Everywhere else it is a
            strong suggestion. Saying the same sentence in both cases would either
            nag people who have already given us a usable address, or fail to warn
            the one person whose form will not submit. */}
        {!coords && (
          <p className="mt-2 text-sm text-amber-700" role={value.method === 'PIN' ? 'status' : undefined}>
            {value.method === 'PIN'
              ? 'No pin yet. Tap the map, or use your current location, to place one — it is what your driver will follow.'
              : 'No pin yet. Belize addresses are often hard to find from the text alone, so a pin makes a real difference to whether your driver arrives at the right door.'}
          </p>
        )}

        {movedFromSaved && (
          <Alert tone="info" className="mt-2">
            You have moved the pin for this delivery. Your saved address is unchanged.
          </Alert>
        )}
      </div>

      {/* ------------------------------------------------- save to address book
          The star. Available the moment the address is complete, whichever way it
          was given — not only once it has been picked from the saved list. It
          shows filled the instant `savedAddressId` is set (an actual reference,
          never a guess from matching the typed text against a label) and stays
          filled if the customer keeps editing an address they picked from the
          book, because moving the pin does not un-save it. */}
      {contact !== 'NONE' && (
        <div className="mt-4 rounded-bmpl-md border border-dashed border-slate-300 p-3">
          {value.savedAddressId ? (
            <p className="flex items-center gap-2 text-sm font-medium text-belize-navy">
              <span aria-hidden="true" className="text-amber-500">★</span>
              Saved in your address book{savedRow ? ` as “${savedRow.label}”` : ''}.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden="true" className="text-lg leading-none text-slate-400">☆</span>
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                placeholder="Name it — Home, Office…"
                aria-label="Name for this saved address"
                className={`${inputClass} max-w-[200px]`}
                disabled={savingAddress}
              />
              <button
                type="button"
                onClick={saveToAddressBook}
                disabled={savingAddress || !labelDraft.trim() || addressGap(value, { contact }) != null}
                className="text-sm font-semibold text-belize-blue hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {savingAddress ? 'Saving…' : 'Save to my addresses'}
              </button>
            </div>
          )}
          {saveError && (
            <Alert tone="warning" className="mt-2">
              {saveError}
            </Alert>
          )}
        </div>
      )}

      {showInstructions && (
        <div className="mt-4">
          <Labelled id={`${uid}-instructions`} label="Instructions for the driver" optional>
            <input
              id={`${uid}-instructions`}
              value={value.instructions}
              onChange={(e) => set({ instructions: e.target.value })}
              placeholder="Gate code, landmark, who to ask for"
              className={inputClass}
            />
          </Labelled>
        </div>
      )}

    </fieldset>
  );
}

const inputClass =
  'w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-base text-slate-900 focus:border-belize-blue focus:outline-none focus:ring-2 focus:ring-belize-blue/30';

function Labelled({
  id,
  label,
  required,
  optional,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="text-red-600"> *</span>}
        {optional && <span className="font-normal normal-case text-slate-400"> (optional)</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import {
  DISTRICTS,
  DISTRICT_LABELS,
  LISTING_PURPOSES,
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  FURNISHINGS,
  FURNISHING_LABELS,
  TENURES,
  RENTAL_PERIODS,
  RENTAL_PERIOD_LABELS,
  AREA_UNITS,
  AREA_UNIT_LABELS,
  LOCATION_VISIBILITIES,
  type ListingPurpose,
  type PropertyType,
  type Furnishing,
  type Tenure,
  type RentalPeriod,
  type AreaUnit,
  type LocationVisibility,
  type District,
} from '@bmpl/shared';
import { type ApiError } from '../../lib/api';
import {
  type ManagedProperty,
  type PropertyInput,
  TENURE_LABELS,
  LOCATION_VISIBILITY_LABELS,
} from '../../lib/realestate';
import { Alert, Badge, Button, Card, Field, Input, Select } from '../ui';

const toMinor = (v: string) => (v.trim() === '' ? 0 : Math.round(Number(v) * 100));
const toDollars = (m: number | null | undefined) => (m == null ? '' : (m / 100).toString());
const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));
const strOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

interface FormState {
  purpose: ListingPurpose;
  propertyType: PropertyType;
  title: string;
  description: string;
  price: string;
  rentalPeriod: string;
  negotiable: boolean;
  district: string;
  locality: string;
  generalAddress: string;
  latitude: string;
  longitude: string;
  locationVisibility: LocationVisibility;
  bedrooms: string;
  bathrooms: string;
  halfBathrooms: string;
  parkingSpaces: string;
  propertySize: string;
  landSize: string;
  areaUnit: string;
  yearBuilt: string;
  furnishing: string;
  tenure: string;
  petPolicy: string;
  availabilityDate: string;
  leaseTerm: string;
  condition: string;
  videoUrl: string;
}

function fromDetail(d?: ManagedProperty): FormState {
  return {
    purpose: d?.purpose ?? 'FOR_SALE',
    propertyType: d?.propertyType ?? 'HOUSE',
    title: d?.title ?? '',
    description: d?.description ?? '',
    price: toDollars(d?.priceMinor),
    rentalPeriod: d?.rentalPeriod ?? '',
    negotiable: d?.negotiable ?? false,
    district: d?.district ?? '',
    locality: d?.locality ?? '',
    generalAddress: d?.generalAddress ?? '',
    latitude: d?.latitude != null ? String(d.latitude) : '',
    longitude: d?.longitude != null ? String(d.longitude) : '',
    locationVisibility: d?.locationVisibility ?? 'DISTRICT_ONLY',
    bedrooms: d?.bedrooms != null ? String(d.bedrooms) : '',
    bathrooms: d?.bathrooms != null ? String(d.bathrooms) : '',
    halfBathrooms: d?.halfBathrooms != null ? String(d.halfBathrooms) : '',
    parkingSpaces: d?.parkingSpaces != null ? String(d.parkingSpaces) : '',
    propertySize: d?.propertySize != null ? String(d.propertySize) : '',
    landSize: d?.landSize != null ? String(d.landSize) : '',
    areaUnit: d?.areaUnit ?? '',
    yearBuilt: d?.yearBuilt != null ? String(d.yearBuilt) : '',
    furnishing: d?.furnishing ?? '',
    tenure: d?.tenure ?? '',
    petPolicy: d?.petPolicy ?? '',
    availabilityDate: d?.availabilityDate ? d.availabilityDate.slice(0, 10) : '',
    leaseTerm: d?.leaseTerm ?? '',
    condition: d?.condition ?? '',
    videoUrl: d?.videoUrl ?? '',
  };
}

/**
 * Create / edit form for a property listing. Location deliberately excludes the exact
 * address — the public API never exposes it, so it is never captured or displayed here.
 * Amenities and utilities are managed as chip lists. Money is entered in BZ$ (converted
 * to minor units on submit).
 */
export function PropertyForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: ManagedProperty;
  submitLabel: string;
  onSubmit: (body: PropertyInput) => Promise<void>;
}) {
  const [v, setV] = useState<FormState>(fromDetail(initial));
  const [amenities, setAmenities] = useState<string[]>(initial?.amenities ?? []);
  const [utilities, setUtilities] = useState<string[]>(initial?.utilities ?? []);
  const [amenity, setAmenity] = useState('');
  const [utility, setUtility] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(k: K, val: FormState[K]) {
    setV((prev) => ({ ...prev, [k]: val }));
  }

  function buildBody(): PropertyInput {
    return {
      purpose: v.purpose,
      propertyType: v.propertyType,
      title: v.title.trim(),
      description: v.description.trim(),
      priceMinor: toMinor(v.price),
      rentalPeriod: (v.rentalPeriod || null) as RentalPeriod | null,
      negotiable: v.negotiable,
      district: (v.district || null) as District | null,
      locality: strOrNull(v.locality),
      generalAddress: strOrNull(v.generalAddress),
      latitude: numOrNull(v.latitude),
      longitude: numOrNull(v.longitude),
      locationVisibility: v.locationVisibility,
      bedrooms: numOrNull(v.bedrooms),
      bathrooms: numOrNull(v.bathrooms),
      halfBathrooms: numOrNull(v.halfBathrooms),
      parkingSpaces: numOrNull(v.parkingSpaces),
      propertySize: numOrNull(v.propertySize),
      landSize: numOrNull(v.landSize),
      areaUnit: (v.areaUnit || null) as AreaUnit | null,
      yearBuilt: numOrNull(v.yearBuilt),
      furnishing: (v.furnishing || null) as Furnishing | null,
      tenure: (v.tenure || null) as Tenure | null,
      petPolicy: strOrNull(v.petPolicy),
      availabilityDate: v.availabilityDate || null,
      leaseTerm: strOrNull(v.leaseTerm),
      condition: strOrNull(v.condition),
      videoUrl: strOrNull(v.videoUrl),
      amenities,
      utilities,
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (v.title.trim().length < 4 || v.description.trim().length < 20) {
      setError('A title (min 4 chars) and a description (min 20 chars) are required.');
      return;
    }
    if (v.purpose === 'FOR_RENT' && !v.rentalPeriod) {
      setError('A rental listing needs a rental period.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(buildBody());
    } catch (e2) {
      setError((e2 as ApiError).message ?? 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Overview</h2>
        <Field label="Listing title">
          <Input value={v.title} onChange={(e) => set('title', e.target.value)} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Purpose">
            <Select value={v.purpose} onChange={(e) => set('purpose', e.target.value as ListingPurpose)}>
              {LISTING_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {LISTING_PURPOSE_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Property type">
            <Select value={v.propertyType} onChange={(e) => set('propertyType', e.target.value as PropertyType)}>
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROPERTY_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Price (BZ$)">
            <Input inputMode="decimal" value={v.price} onChange={(e) => set('price', e.target.value)} placeholder="0" />
          </Field>
          {v.purpose === 'FOR_RENT' && (
            <Field label="Rental period">
              <Select value={v.rentalPeriod} onChange={(e) => set('rentalPeriod', e.target.value)}>
                <option value="">Select…</option>
                {RENTAL_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {RENTAL_PERIOD_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={v.negotiable}
            onChange={(e) => set('negotiable', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
          />
          Price is negotiable
        </label>
        <Field label="Description">
          <textarea className="bmpl-input" rows={5} value={v.description} onChange={(e) => set('description', e.target.value)} required />
        </Field>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Location</h2>
        <p className="text-xs text-slate-500">
          The exact address is never shown publicly. Choose how much of the location to reveal.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="District">
            <Select value={v.district} onChange={(e) => set('district', e.target.value)}>
              <option value="">Select…</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {DISTRICT_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Locality / town">
            <Input value={v.locality} onChange={(e) => set('locality', e.target.value)} />
          </Field>
          <Field label="General address (public)">
            <Input value={v.generalAddress} onChange={(e) => set('generalAddress', e.target.value)} placeholder="e.g. Near Central Park" />
          </Field>
          <Field label="Location visibility">
            <Select value={v.locationVisibility} onChange={(e) => set('locationVisibility', e.target.value as LocationVisibility)}>
              {LOCATION_VISIBILITIES.map((x) => (
                <option key={x} value={x}>
                  {LOCATION_VISIBILITY_LABELS[x]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Latitude (optional)">
            <Input inputMode="decimal" value={v.latitude} onChange={(e) => set('latitude', e.target.value)} />
          </Field>
          <Field label="Longitude (optional)">
            <Input inputMode="decimal" value={v.longitude} onChange={(e) => set('longitude', e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Property details</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Bedrooms">
            <Input inputMode="numeric" value={v.bedrooms} onChange={(e) => set('bedrooms', e.target.value)} />
          </Field>
          <Field label="Bathrooms">
            <Input inputMode="numeric" value={v.bathrooms} onChange={(e) => set('bathrooms', e.target.value)} />
          </Field>
          <Field label="Half baths">
            <Input inputMode="numeric" value={v.halfBathrooms} onChange={(e) => set('halfBathrooms', e.target.value)} />
          </Field>
          <Field label="Parking spaces">
            <Input inputMode="numeric" value={v.parkingSpaces} onChange={(e) => set('parkingSpaces', e.target.value)} />
          </Field>
          <Field label="Property size">
            <Input inputMode="decimal" value={v.propertySize} onChange={(e) => set('propertySize', e.target.value)} />
          </Field>
          <Field label="Land size">
            <Input inputMode="decimal" value={v.landSize} onChange={(e) => set('landSize', e.target.value)} />
          </Field>
          <Field label="Area unit">
            <Select value={v.areaUnit} onChange={(e) => set('areaUnit', e.target.value)}>
              <option value="">—</option>
              {AREA_UNITS.map((u) => (
                <option key={u} value={u}>
                  {AREA_UNIT_LABELS[u]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year built">
            <Input inputMode="numeric" value={v.yearBuilt} onChange={(e) => set('yearBuilt', e.target.value)} />
          </Field>
          <Field label="Furnishing">
            <Select value={v.furnishing} onChange={(e) => set('furnishing', e.target.value)}>
              <option value="">—</option>
              {FURNISHINGS.map((f) => (
                <option key={f} value={f}>
                  {FURNISHING_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tenure">
            <Select value={v.tenure} onChange={(e) => set('tenure', e.target.value)}>
              <option value="">—</option>
              {TENURES.map((t) => (
                <option key={t} value={t}>
                  {TENURE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Availability date (optional)">
            <Input type="date" value={v.availabilityDate} onChange={(e) => set('availabilityDate', e.target.value)} />
          </Field>
          <Field label="Lease term (optional)">
            <Input value={v.leaseTerm} onChange={(e) => set('leaseTerm', e.target.value)} />
          </Field>
          <Field label="Condition (optional)">
            <Input value={v.condition} onChange={(e) => set('condition', e.target.value)} />
          </Field>
          <Field label="Pet policy (optional)">
            <Input value={v.petPolicy} onChange={(e) => set('petPolicy', e.target.value)} />
          </Field>
          <Field label="Video URL (optional)">
            <Input value={v.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} placeholder="https://" />
          </Field>
        </div>
      </Card>

      <ChipEditor
        title="Amenities"
        items={amenities}
        value={amenity}
        onValue={setAmenity}
        onAdd={(x) => setAmenities([...amenities, x])}
        onRemove={(i) => setAmenities(amenities.filter((_, j) => j !== i))}
        placeholder="e.g. Pool"
      />
      <ChipEditor
        title="Utilities"
        items={utilities}
        value={utility}
        onValue={setUtility}
        onAdd={(x) => setUtilities([...utilities, x])}
        onRemove={(i) => setUtilities(utilities.filter((_, j) => j !== i))}
        placeholder="e.g. Water included"
      />

      <div>
        <Button disabled={busy} size="lg">
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function ChipEditor({
  title,
  items,
  value,
  onValue,
  onAdd,
  onRemove,
  placeholder,
}: {
  title: string;
  items: string[];
  value: string;
  onValue: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (i: number) => void;
  placeholder: string;
}) {
  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <h2 className="bmpl-eyebrow">{title}</h2>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 && <p className="text-sm text-slate-400">None added.</p>}
        {items.map((x, i) => (
          <span key={`${x}-${i}`} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
            {x}
            <button type="button" aria-label={`Remove ${x}`} onClick={() => onRemove(i)} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs text-red-600 hover:bg-red-50">
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={value} onChange={(e) => onValue(e.target.value)} placeholder={placeholder} className="max-w-xs" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const t = value.trim();
            if (t) {
              onAdd(t);
              onValue('');
            }
          }}
        >
          Add
        </Button>
        {items.length > 0 && <Badge tone="neutral">{items.length}</Badge>}
      </div>
    </Card>
  );
}

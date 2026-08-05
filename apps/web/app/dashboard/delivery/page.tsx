'use client';

import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../lib/api';
import { kmToMilesInput, milesInputToKm } from '@bmpl/shared';
import {
  Card as UiCard,
  PageHeader,
  Field,
  Input,
  Button,
  Badge,
  Alert,
  Spinner,
  EmptyState,
} from '../../../components/ui';

const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'];

interface DeliverySettings {
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  baseDeliveryFeeMinor: number | null;
  freeDeliveryThresholdMinor: number | null;
  minimumOrderMinor: number | null;
  deliveryRadiusKm: number | null;
}

interface DeliveryZone {
  id: string;
  name: string;
  districts: string[];
  feeMinor: number;
  isActive: boolean;
  position: number;
}

interface DeliveryEstimate {
  minHours: number;
  maxHours: number;
  label: string | null;
}

interface DeliveryData {
  settings: DeliverySettings;
  zones: DeliveryZone[];
  estimate: DeliveryEstimate | null;
}

function toDollarStr(minor: number | null): string {
  return minor == null ? '' : (minor / 100).toFixed(2);
}
function dollarsToCentsOrNull(v: string): number | null {
  const t = v.trim();
  return t === '' ? null : Math.round(Number(t) * 100);
}
function dollarsToCents(v: string): number {
  const t = v.trim();
  return t === '' ? 0 : Math.round(Number(t) * 100);
}
function districtLabel(d: string): string {
  return d
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}
function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}

export default function DeliveryPage() {
  const [data, setData] = useState<DeliveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsStore, setNeedsStore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const d = await api.get<DeliveryData>('/vendor/delivery');
      setData(d);
      setNeedsStore(false);
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) {
        setNeedsStore(true);
      } else {
        setError(errMessage(e));
      }
    }
  }

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Delivery settings" description="Offer pickup, delivery, or both — and set your delivery pricing." />

      {error && <Alert tone="error">{error}</Alert>}

      {needsStore ? (
        <Alert tone="warning" title="Create your storefront first">
          You need an active storefront before you can configure delivery settings.{' '}
          <Link href="/dashboard/store" className="font-semibold underline">
            Go to My Store
          </Link>
        </Alert>
      ) : data ? (
        <>
          <PricingSection data={data} onDone={reload} />
          <ZonesSection data={data} onDone={reload} />
          <EstimateSection data={data} onDone={reload} />
        </>
      ) : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <UiCard className="p-5 sm:p-6">
      <h2 className="bmpl-eyebrow mb-4">{title}</h2>
      {children}
    </UiCard>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function DistrictCheckboxes({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="bmpl-label mb-1.5">Districts</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {DISTRICTS.map((d) => {
          const id = `${idPrefix}-${d}`;
          const checked = value.includes(d);
          return (
            <label key={d} htmlFor={id} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                id={id}
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
                checked={checked}
                onChange={(e) => onChange(e.target.checked ? [...value, d] : value.filter((x) => x !== d))}
              />
              {districtLabel(d)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ---------------------------------------------------------- pricing card */

function PricingSection({ data, onDone }: { data: DeliveryData; onDone: () => Promise<void> }) {
  const s = data.settings;
  const [f, setF] = useState({
    pickupEnabled: s.pickupEnabled,
    deliveryEnabled: s.deliveryEnabled,
    baseDeliveryFeeMinor: toDollarStr(s.baseDeliveryFeeMinor),
    freeDeliveryThresholdMinor: toDollarStr(s.freeDeliveryThresholdMinor),
    minimumOrderMinor: toDollarStr(s.minimumOrderMinor),
    // Displayed/entered in miles; stored canonically in km.
    deliveryRadiusMi: kmToMilesInput(s.deliveryRadiusKm),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.patch('/vendor/settings', {
        pickupEnabled: f.pickupEnabled,
        deliveryEnabled: f.deliveryEnabled,
        baseDeliveryFeeMinor: dollarsToCentsOrNull(f.baseDeliveryFeeMinor),
        freeDeliveryThresholdMinor: dollarsToCentsOrNull(f.freeDeliveryThresholdMinor),
        minimumOrderMinor: dollarsToCentsOrNull(f.minimumOrderMinor),
        deliveryRadiusKm: milesInputToKm(f.deliveryRadiusMi),
      });
      setMsg('Delivery settings saved.');
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Fulfilment & pricing">
      {msg && (
        <Alert tone="success" className="mb-4">
          {msg}
        </Alert>
      )}
      {err && (
        <Alert tone="error" className="mb-4">
          {err}
        </Alert>
      )}
      <form className="space-y-4" onSubmit={submit}>
        <div className="flex flex-wrap gap-6">
          <Check label="Pickup available" checked={f.pickupEnabled} onChange={(v) => setF({ ...f, pickupEnabled: v })} />
          <Check label="Delivery available" checked={f.deliveryEnabled} onChange={(v) => setF({ ...f, deliveryEnabled: v })} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Base delivery fee ($)" htmlFor="baseDeliveryFeeMinor">
            <Input
              id="baseDeliveryFeeMinor"
              inputMode="decimal"
              placeholder="0.00"
              value={f.baseDeliveryFeeMinor}
              onChange={(e) => setF({ ...f, baseDeliveryFeeMinor: e.target.value })}
            />
          </Field>
          <Field label="Free delivery threshold ($)" htmlFor="freeDeliveryThresholdMinor" hint="Optional — leave blank for no free-delivery threshold.">
            <Input
              id="freeDeliveryThresholdMinor"
              inputMode="decimal"
              placeholder="none"
              value={f.freeDeliveryThresholdMinor}
              onChange={(e) => setF({ ...f, freeDeliveryThresholdMinor: e.target.value })}
            />
          </Field>
          <Field label="Minimum delivery order ($)" htmlFor="minimumOrderMinor" hint="Optional — leave blank for no minimum.">
            <Input
              id="minimumOrderMinor"
              inputMode="decimal"
              placeholder="none"
              value={f.minimumOrderMinor}
              onChange={(e) => setF({ ...f, minimumOrderMinor: e.target.value })}
            />
          </Field>
          <Field label="Maximum delivery radius (mi)" htmlFor="deliveryRadiusMi" hint="Optional — leave blank for no limit.">
            <Input
              id="deliveryRadiusMi"
              inputMode="decimal"
              placeholder="none"
              value={f.deliveryRadiusMi}
              onChange={(e) => setF({ ...f, deliveryRadiusMi: e.target.value })}
            />
          </Field>
        </div>
        <Button disabled={busy}>Save delivery settings</Button>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------ zones card */

function ZonesSection({ data, onDone }: { data: DeliveryData; onDone: () => Promise<void> }) {
  const zones = [...data.zones].sort((a, b) => a.position - b.position);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Card title="Delivery zones">
      {err && (
        <Alert tone="error" className="mb-4">
          {err}
        </Alert>
      )}

      {zones.length === 0 ? (
        <EmptyState title="No delivery zones yet" description="Add a zone to charge different delivery fees by district." />
      ) : (
        <ul className="mb-6 space-y-3">
          {zones.map((z) =>
            editingId === z.id ? (
              <li key={z.id}>
                <ZoneEditForm
                  zone={z}
                  onCancel={() => setEditingId(null)}
                  onSaved={async () => {
                    setEditingId(null);
                    setErr(null);
                    await onDone();
                  }}
                  onError={setErr}
                />
              </li>
            ) : (
              <ZoneRow
                key={z.id}
                zone={z}
                onEdit={() => {
                  setErr(null);
                  setEditingId(z.id);
                }}
                onDeleted={async () => {
                  setErr(null);
                  await onDone();
                }}
                onError={setErr}
              />
            ),
          )}
        </ul>
      )}

      <AddZoneForm
        onAdded={async () => {
          setErr(null);
          await onDone();
        }}
        onError={setErr}
      />
    </Card>
  );
}

function ZoneRow({
  zone,
  onEdit,
  onDeleted,
  onError,
}: {
  zone: DeliveryZone;
  onEdit: () => void;
  onDeleted: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-bmpl-md border border-slate-100 bg-slate-50 px-3 py-2.5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-sm text-belize-navy">{zone.name}</b>
          <Badge tone={zone.isActive ? 'success' : 'neutral'}>{zone.isActive ? 'Active' : 'Inactive'}</Badge>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {zone.districts.map((d) => (
            <Badge key={d} tone="brand">
              {districtLabel(d)}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-belize-navy">${(zone.feeMinor / 100).toFixed(2)}</span>
        <Button type="button" size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onDeleteZone(zone.id);
              await onDeleted();
            } catch (e) {
              onError(errMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

async function onDeleteZone(id: string) {
  await api.del(`/vendor/delivery/zones/${id}`);
}

function ZoneEditForm({
  zone,
  onCancel,
  onSaved,
  onError,
}: {
  zone: DeliveryZone;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(zone.name);
  const [districts, setDistricts] = useState<string[]>(zone.districts);
  const [fee, setFee] = useState(toDollarStr(zone.feeMinor));
  const [isActive, setIsActive] = useState(zone.isActive);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      await api.patch(`/vendor/delivery/zones/${zone.id}`, {
        name,
        districts,
        feeMinor: dollarsToCents(fee),
        isActive,
      });
      await onSaved();
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3 rounded-bmpl-md border border-belize-blue/30 bg-belize-blue/5 p-3" onSubmit={submit}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Zone name" htmlFor={`edit-name-${zone.id}`}>
          <Input id={`edit-name-${zone.id}`} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Fee ($)" htmlFor={`edit-fee-${zone.id}`}>
          <Input id={`edit-fee-${zone.id}`} inputMode="decimal" placeholder="0.00" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
      </div>
      <DistrictCheckboxes idPrefix={`edit-${zone.id}`} value={districts} onChange={setDistricts} />
      <Check label="Active" checked={isActive} onChange={setIsActive} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !name || districts.length === 0}>
          Save zone
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AddZoneForm({ onAdded, onError }: { onAdded: () => Promise<void>; onError: (m: string) => void }) {
  const [name, setName] = useState('');
  const [districts, setDistricts] = useState<string[]>([]);
  const [fee, setFee] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      await api.post('/vendor/delivery/zones', {
        name,
        districts,
        feeMinor: dollarsToCents(fee),
      });
      setName('');
      setDistricts([]);
      setFee('');
      await onAdded();
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3 border-t border-slate-100 pt-5" onSubmit={submit}>
      <p className="bmpl-label">＋ Add zone</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Zone name" htmlFor="new-zone-name">
          <Input id="new-zone-name" placeholder="e.g. Belize City" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Fee ($)" htmlFor="new-zone-fee">
          <Input id="new-zone-fee" inputMode="decimal" placeholder="0.00" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
      </div>
      <DistrictCheckboxes idPrefix="new-zone" value={districts} onChange={setDistricts} />
      <Button size="sm" disabled={busy || !name || districts.length === 0}>
        Add zone
      </Button>
    </form>
  );
}

/* --------------------------------------------------------- estimate card */

function EstimateSection({ data, onDone }: { data: DeliveryData; onDone: () => Promise<void> }) {
  const est = data.estimate;
  const [f, setF] = useState({
    minHours: est?.minHours != null ? String(est.minHours) : '',
    maxHours: est?.maxHours != null ? String(est.maxHours) : '',
    label: est?.label ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.put('/vendor/delivery/estimate', {
        minHours: Number(f.minHours),
        maxHours: Number(f.maxHours),
        label: f.label.trim() === '' ? undefined : f.label.trim(),
      });
      setMsg('Estimated delivery time saved.');
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Estimated delivery time">
      {msg && (
        <Alert tone="success" className="mb-4">
          {msg}
        </Alert>
      )}
      {err && (
        <Alert tone="error" className="mb-4">
          {err}
        </Alert>
      )}
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Minimum hours" htmlFor="minHours">
            <Input
              id="minHours"
              inputMode="numeric"
              placeholder="e.g. 24"
              value={f.minHours}
              onChange={(e) => setF({ ...f, minHours: e.target.value })}
            />
          </Field>
          <Field label="Maximum hours" htmlFor="maxHours">
            <Input
              id="maxHours"
              inputMode="numeric"
              placeholder="e.g. 72"
              value={f.maxHours}
              onChange={(e) => setF({ ...f, maxHours: e.target.value })}
            />
          </Field>
          <Field label="Label" htmlFor="estimateLabel" hint="Optional, e.g. “1–3 business days”.">
            <Input id="estimateLabel" placeholder="1–3 business days" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          </Field>
        </div>
        <Button disabled={busy || f.minHours.trim() === '' || f.maxHours.trim() === ''}>Save estimate</Button>
      </form>
    </Card>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { uploadFile } from '../../lib/uploads';
import { Alert, Badge, Button, EmptyState, Field, Input, Label, Select, Spinner, StatusBadge } from '../ui';
import { Card, errMessage, expiryTone, toDateInputValue, type Vehicle } from './dashboard-data';

const VEHICLE_TYPES: Array<{ value: Vehicle['type']; label: string }> = [
  { value: 'CAR', label: 'Car' },
  { value: 'MOTORCYCLE', label: 'Motorcycle' },
  { value: 'SCOOTER', label: 'Scooter' },
  { value: 'BICYCLE', label: 'Bicycle' },
  { value: 'VAN', label: 'Van' },
  { value: 'TRUCK', label: 'Truck' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * The driver's vehicles and their approval status.
 *
 * Approval is entirely the admin's: this screen shows the decision and any
 * rejection reason but never sets `approvalStatus`, and an unapproved vehicle
 * still fails the server-side eligibility check that gates going online.
 */
export function VehicleManager({ vehicles, onDone }: { vehicles: Vehicle[]; onDone: () => Promise<void> }) {
  const [addingOpen, setAddingOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Card title="Vehicles">
      {err && (
        <Alert tone="error" className="mb-4">
          {err}
        </Alert>
      )}

      {vehicles.length === 0 && !addingOpen && (
        <EmptyState title="No vehicles yet" description="Add a vehicle to start receiving delivery jobs." />
      )}

      {vehicles.length > 0 && (
        <ul className="mb-4 space-y-3">
          {vehicles.map((v) =>
            editingId === v.id ? (
              <li key={v.id}>
                <VehicleForm
                  vehicle={v}
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
              <VehicleRow
                key={v.id}
                vehicle={v}
                onEdit={() => {
                  setErr(null);
                  setEditingId(v.id);
                }}
                onChanged={async () => {
                  setErr(null);
                  await onDone();
                }}
                onError={setErr}
              />
            ),
          )}
        </ul>
      )}

      {addingOpen ? (
        <VehicleForm
          onCancel={() => setAddingOpen(false)}
          onSaved={async () => {
            setAddingOpen(false);
            setErr(null);
            await onDone();
          }}
          onError={setErr}
        />
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAddingOpen(true)}>
          + Add vehicle
        </Button>
      )}
    </Card>
  );
}

function VehicleRow({
  vehicle,
  onEdit,
  onChanged,
  onError,
}: {
  vehicle: Vehicle;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const typeLabel = VEHICLE_TYPES.find((t) => t.value === vehicle.type)?.label ?? vehicle.type;

  return (
    <li className="rounded-bmpl-md border border-slate-100 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm text-belize-navy">
              {vehicle.year ? `${vehicle.year} ` : ''}
              {vehicle.make} {vehicle.model}
            </b>
            <Badge tone="brand">{typeLabel}</Badge>
            {vehicle.isPrimary && <Badge tone="success">Primary</Badge>}
            <StatusBadge status={vehicle.approvalStatus} />
            {!vehicle.isActive && <Badge tone="neutral">Inactive</Badge>}
          </div>
          <p className="mt-1 break-words text-sm text-slate-500">Plate: {vehicle.licencePlate}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {vehicle.registrationExpiryStatus && (
              <Badge tone={expiryTone(vehicle.registrationExpiryStatus)}>
                Registration: {vehicle.registrationExpiryStatus.replace('_', ' ')}
              </Badge>
            )}
            {vehicle.insuranceExpiryStatus && (
              <Badge tone={expiryTone(vehicle.insuranceExpiryStatus)}>Insurance: {vehicle.insuranceExpiryStatus.replace('_', ' ')}</Badge>
            )}
          </div>
          {vehicle.rejectionReason && <p className="mt-1.5 break-words text-xs text-red-600">Reason: {vehicle.rejectionReason}</p>}
          {vehicle.photoUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {vehicle.photoUrls.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={u} alt="" className="h-12 w-12 rounded-bmpl-md border border-slate-200 object-cover" />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!vehicle.isPrimary && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.patch(`/driver/vehicles/${vehicle.id}`, { isPrimary: true });
                  await onChanged();
                } catch (e) {
                  onError(errMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Set primary
            </Button>
          )}
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
                await api.del(`/driver/vehicles/${vehicle.id}`);
                await onChanged();
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
      </div>
    </li>
  );
}

function VehicleForm({
  vehicle,
  onCancel,
  onSaved,
  onError,
}: {
  vehicle?: Vehicle;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const isEdit = !!vehicle;
  const idBase = vehicle?.id ?? 'new';
  const [f, setF] = useState({
    type: vehicle?.type ?? 'CAR',
    make: vehicle?.make ?? '',
    model: vehicle?.model ?? '',
    year: vehicle?.year != null ? String(vehicle.year) : '',
    color: vehicle?.color ?? '',
    licencePlate: vehicle?.licencePlate ?? '',
    registrationNumber: vehicle?.registrationNumber ?? '',
    registrationExpiry: toDateInputValue(vehicle?.registrationExpiry),
    insuranceProvider: vehicle?.insuranceProvider ?? '',
    insurancePolicyNumber: vehicle?.insurancePolicyNumber ?? '',
    insuranceExpiry: toDateInputValue(vehicle?.insuranceExpiry),
    isPrimary: vehicle?.isPrimary ?? false,
    isActive: vehicle?.isActive ?? true,
  });
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  async function addPhoto(file: File) {
    setPhotoBusy(true);
    onError('');
    try {
      const key = await uploadFile('/driver/vehicles/photo/upload', file);
      setPhotoKeys((k) => [...k, key]);
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      const body: Record<string, unknown> = {
        type: f.type,
        make: f.make,
        model: f.model,
        year: f.year.trim() === '' ? undefined : Number(f.year),
        color: f.color || undefined,
        licencePlate: f.licencePlate,
        registrationNumber: f.registrationNumber || undefined,
        registrationExpiry: f.registrationExpiry || undefined,
        insuranceProvider: f.insuranceProvider || undefined,
        insurancePolicyNumber: f.insurancePolicyNumber || undefined,
        insuranceExpiry: f.insuranceExpiry || undefined,
        isPrimary: f.isPrimary,
      };
      if (photoKeys.length > 0) body.photoKeys = photoKeys;
      if (isEdit) {
        body.isActive = f.isActive;
        await api.patch(`/driver/vehicles/${vehicle!.id}`, body);
      } else {
        await api.post('/driver/vehicles', body);
      }
      await onSaved();
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-bmpl-md border border-belize-blue/30 bg-belize-blue/5 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor={`type-${idBase}`}>
          <Select id={`type-${idBase}`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Vehicle['type'] })}>
            {VEHICLE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Licence plate" htmlFor={`plate-${idBase}`}>
          <Input id={`plate-${idBase}`} value={f.licencePlate} onChange={(e) => setF({ ...f, licencePlate: e.target.value })} required />
        </Field>
        <Field label="Make" htmlFor={`make-${idBase}`}>
          <Input id={`make-${idBase}`} value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} required />
        </Field>
        <Field label="Model" htmlFor={`model-${idBase}`}>
          <Input id={`model-${idBase}`} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} required />
        </Field>
        <Field label="Year" htmlFor={`year-${idBase}`} hint="Optional">
          <Input id={`year-${idBase}`} inputMode="numeric" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
        </Field>
        <Field label="Color" htmlFor={`color-${idBase}`} hint="Optional">
          <Input id={`color-${idBase}`} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
        </Field>
        <Field label="Registration number" htmlFor={`regno-${idBase}`} hint="Optional">
          <Input id={`regno-${idBase}`} value={f.registrationNumber} onChange={(e) => setF({ ...f, registrationNumber: e.target.value })} />
        </Field>
        <Field label="Registration expiry" htmlFor={`regexp-${idBase}`} hint="Optional">
          <Input
            id={`regexp-${idBase}`}
            type="date"
            value={f.registrationExpiry}
            onChange={(e) => setF({ ...f, registrationExpiry: e.target.value })}
          />
        </Field>
        <Field label="Insurance provider" htmlFor={`insprov-${idBase}`} hint="Optional">
          <Input id={`insprov-${idBase}`} value={f.insuranceProvider} onChange={(e) => setF({ ...f, insuranceProvider: e.target.value })} />
        </Field>
        <Field label="Insurance policy number" htmlFor={`inspol-${idBase}`} hint="Optional">
          <Input
            id={`inspol-${idBase}`}
            value={f.insurancePolicyNumber}
            onChange={(e) => setF({ ...f, insurancePolicyNumber: e.target.value })}
          />
        </Field>
        <Field label="Insurance expiry" htmlFor={`insexp-${idBase}`} hint="Optional">
          <Input
            id={`insexp-${idBase}`}
            type="date"
            value={f.insuranceExpiry}
            onChange={(e) => setF({ ...f, insuranceExpiry: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
            checked={f.isPrimary}
            onChange={(e) => setF({ ...f, isPrimary: e.target.checked })}
          />
          Primary vehicle
        </label>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
              checked={f.isActive}
              onChange={(e) => setF({ ...f, isActive: e.target.checked })}
            />
            Active
          </label>
        )}
      </div>

      <div>
        <Label>Vehicle photos</Label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {vehicle?.photoUrls.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" className="h-12 w-12 rounded-bmpl-md border border-slate-200 object-cover" />
          ))}
          {photoKeys.map((k) => (
            <Badge key={k} tone="success">
              Photo added
            </Badge>
          ))}
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-belize-navy transition hover:border-belize-blue hover:bg-belize-blue/5">
            {photoBusy ? <Spinner className="h-4 w-4" /> : 'Add photo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={photoBusy}
              onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])}
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !f.make || !f.model || !f.licencePlate}>
          {isEdit ? 'Save vehicle' : 'Add vehicle'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

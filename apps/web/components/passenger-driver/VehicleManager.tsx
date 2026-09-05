'use client';

import { useState, type FormEvent } from 'react';
import { PASSENGER_VEHICLE_TYPES, PASSENGER_VEHICLE_TYPE_LABELS, MAX_PASSENGER_SEATS, type PassengerVehicleType } from '@bmpl/shared';
import { api } from '../../lib/api';
import { Alert, Badge, Button, EmptyState, Field, Input, Select, StatusBadge } from '../ui';
import { Card, errMessage, expiryTone, toDateInputValue } from '../driver/dashboard-data';
import type { PassengerVehicle } from '../../lib/passenger-driver';

/**
 * The passenger driver's own vehicles and their approval status.
 *
 * Approval is entirely the admin's: this screen shows the decision and any
 * rejection reason but never sets `approvalStatus`, and an unapproved vehicle
 * still fails the server-side eligibility check that gates going online.
 * `seatCapacity` is the field that makes a vehicle a PASSENGER vehicle —
 * seats available to sell, excluding the driver. No photo upload here: the
 * passenger API deliberately accepts no storage keys yet.
 */
export function PassengerVehicleManager({ vehicles, onDone }: { vehicles: PassengerVehicle[]; onDone: () => Promise<void> }) {
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
        <EmptyState title="No vehicles yet" description="Add a vehicle with its seat capacity — a departure can only be assigned to a driver with an approved vehicle." />
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
  vehicle: PassengerVehicle;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const typeLabel = PASSENGER_VEHICLE_TYPE_LABELS[vehicle.type as PassengerVehicleType] ?? vehicle.type;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api.patch(`/passenger/driver/vehicles/${vehicle.id}`, body);
      await onChanged();
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

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
            <Badge tone="neutral">
              {vehicle.seatCapacity} seat{vehicle.seatCapacity === 1 ? '' : 's'}
            </Badge>
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!vehicle.isPrimary && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => patch({ isPrimary: true })}>
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
                await api.del(`/passenger/driver/vehicles/${vehicle.id}`);
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
  vehicle?: PassengerVehicle;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const isEdit = !!vehicle;
  const idBase = vehicle?.id ?? 'new';
  const [f, setF] = useState({
    type: (vehicle?.type as PassengerVehicleType) ?? 'CAR',
    make: vehicle?.make ?? '',
    model: vehicle?.model ?? '',
    year: vehicle?.year != null ? String(vehicle.year) : '',
    color: vehicle?.color ?? '',
    licencePlate: vehicle?.licencePlate ?? '',
    registrationNumber: vehicle?.registrationNumber ?? '',
    registrationExpiry: toDateInputValue(vehicle?.registrationExpiry),
    insuranceProvider: vehicle?.insuranceProvider ?? '',
    insurancePolicyNumber: '',
    insuranceExpiry: toDateInputValue(vehicle?.insuranceExpiry),
    seatCapacity: vehicle?.seatCapacity != null ? String(vehicle.seatCapacity) : '',
    isPrimary: vehicle?.isPrimary ?? false,
    isActive: vehicle?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);

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
        seatCapacity: Number(f.seatCapacity),
        isPrimary: f.isPrimary,
      };
      if (isEdit) {
        body.isActive = f.isActive;
        await api.patch(`/passenger/driver/vehicles/${vehicle.id}`, body);
      } else {
        await api.post('/passenger/driver/vehicles', body);
      }
      await onSaved();
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4 rounded-bmpl-md border border-slate-200 p-3 sm:p-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor={`${idBase}-type`}>
          <Select id={`${idBase}-type`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as PassengerVehicleType })}>
            {PASSENGER_VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {PASSENGER_VEHICLE_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Passenger seats"
          htmlFor={`${idBase}-seats`}
          hint="Seats available to passengers, not counting the driver."
        >
          <Input
            id={`${idBase}-seats`}
            type="number"
            min={1}
            max={MAX_PASSENGER_SEATS}
            value={f.seatCapacity}
            onChange={(e) => setF({ ...f, seatCapacity: e.target.value })}
            required
          />
        </Field>
        <Field label="Make" htmlFor={`${idBase}-make`}>
          <Input id={`${idBase}-make`} value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} required />
        </Field>
        <Field label="Model" htmlFor={`${idBase}-model`}>
          <Input id={`${idBase}-model`} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} required />
        </Field>
        <Field label="Year" htmlFor={`${idBase}-year`} hint="Optional">
          <Input id={`${idBase}-year`} type="number" min={1900} max={2100} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
        </Field>
        <Field label="Colour" htmlFor={`${idBase}-color`} hint="Optional">
          <Input id={`${idBase}-color`} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
        </Field>
        <Field label="Licence plate" htmlFor={`${idBase}-plate`}>
          <Input id={`${idBase}-plate`} value={f.licencePlate} onChange={(e) => setF({ ...f, licencePlate: e.target.value })} required />
        </Field>
        <Field label="Registration number" htmlFor={`${idBase}-reg`} hint="Optional">
          <Input id={`${idBase}-reg`} value={f.registrationNumber} onChange={(e) => setF({ ...f, registrationNumber: e.target.value })} />
        </Field>
        <Field label="Registration expiry" htmlFor={`${idBase}-regExp`} hint="Optional">
          <Input
            id={`${idBase}-regExp`}
            type="date"
            value={f.registrationExpiry}
            onChange={(e) => setF({ ...f, registrationExpiry: e.target.value })}
          />
        </Field>
        <Field label="Insurance provider" htmlFor={`${idBase}-insProv`} hint="Optional">
          <Input id={`${idBase}-insProv`} value={f.insuranceProvider} onChange={(e) => setF({ ...f, insuranceProvider: e.target.value })} />
        </Field>
        <Field label="Insurance policy number" htmlFor={`${idBase}-insNum`} hint="Optional">
          <Input
            id={`${idBase}-insNum`}
            value={f.insurancePolicyNumber}
            onChange={(e) => setF({ ...f, insurancePolicyNumber: e.target.value })}
          />
        </Field>
        <Field label="Insurance expiry" htmlFor={`${idBase}-insExp`} hint="Optional">
          <Input
            id={`${idBase}-insExp`}
            type="date"
            value={f.insuranceExpiry}
            onChange={(e) => setF({ ...f, insuranceExpiry: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-4">
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

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !f.make || !f.model || !f.licencePlate || !f.seatCapacity}>
          {isEdit ? 'Save vehicle' : 'Add vehicle'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

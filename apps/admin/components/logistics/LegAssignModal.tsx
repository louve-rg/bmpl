'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Button, Field, Select, Spinner, Textarea } from '../ui';

/**
 * Hand a shipment courier leg to a driver, or take it away from one.
 *
 * Mirrors the deliveries dispatch console's assign modal — the interaction an
 * operator already knows — pointed at the shipping leg endpoints. The candidate
 * list is rendered in the order the API returns it: everyone on it is already
 * online, approved, in-district and driving an approved vehicle with valid
 * documents, and this screen does not re-rank, re-sort or invent any figure
 * (distance, ETA, capacity) the endpoint does not send.
 */

interface EligibleVehicle {
  id: string;
  type: string | null;
  make: string | null;
  model: string | null;
  licencePlate: string | null;
  isPrimary: boolean;
}

interface EligibleDriver {
  driverProfileId: string;
  displayName: string | null;
  name: string;
  homeDistrict: string | null;
  completedDeliveries: number | null;
  activeJobs: number | null;
  vehicles: EligibleVehicle[];
}

/** A load figure the API does not know is shown as unknown, never as zero. */
const loadLabel = (n: number | null) =>
  n == null ? 'load unknown' : `${n} live job${n === 1 ? '' : 's'}`;

export function LegAssignModal({
  legId,
  mode,
  currentOperator,
  onClose,
  onDone,
}: {
  legId: string;
  mode: 'assign' | 'reassign';
  /** Who has the leg now, so a reassignment says who it is being taken from. */
  currentOperator: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [drivers, setDrivers] = useState<EligibleDriver[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await api.get<EligibleDriver[]>(`/admin/logistics/legs/${legId}/eligible-drivers`);
        if (active) setDrivers(list);
      } catch (e) {
        const ex = e as ApiError;
        if (active) {
          setLoadErr(ex.status === 403 ? 'You do not have permission to assign drivers.' : ex.message ?? 'Failed to load drivers.');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [legId]);

  const selectedDriver = drivers?.find((d) => d.driverProfileId === driverId) ?? null;

  async function submit() {
    if (!driverId || !vehicleId) {
      setErr('Select a driver and vehicle.');
      return;
    }
    if (mode === 'reassign' && !reason.trim()) {
      setErr('A reason is required to reassign.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'assign') {
        await api.post(`/admin/logistics/legs/${legId}/assign`, { driverProfileId: driverId, vehicleId });
      } else {
        await api.post(`/admin/logistics/legs/${legId}/reassign`, { driverProfileId: driverId, vehicleId, reason: reason.trim() });
      }
      onDone();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Action failed.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={mode === 'assign' ? 'Assign driver' : 'Reassign driver'}>
      <div className="w-full max-w-md rounded-bmpl-xl border border-slate-200 bg-white p-5 shadow-bmpl-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-belize-navy">
            {mode === 'assign' ? 'Assign driver' : 'Reassign driver'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {mode === 'reassign' && currentOperator && (
          <p className="mb-3 text-sm text-slate-600">
            Currently with <span className="font-medium text-slate-800">{currentOperator}</span>.
          </p>
        )}

        {loadErr ? (
          <p className="rounded-bmpl-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadErr}</p>
        ) : drivers === null ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading eligible drivers…
          </div>
        ) : drivers.length === 0 ? (
          <p className="text-sm text-slate-500">
            No eligible driver is available for this leg right now — nobody online in this district can take it.
          </p>
        ) : (
          <div className="space-y-4">
            <Field label="Driver">
              <Select
                value={driverId}
                onChange={(e) => {
                  setDriverId(e.target.value);
                  setVehicleId('');
                }}
              >
                <option value="">Select a driver…</option>
                {drivers.map((d) => (
                  <option key={d.driverProfileId} value={d.driverProfileId}>
                    {d.displayName || d.name}
                    {` · ${loadLabel(d.activeJobs)}`}
                    {d.homeDistrict ? ` · ${d.homeDistrict.replace(/_/g, ' ')}` : ''}
                    {d.completedDeliveries != null ? ` · ${d.completedDeliveries} done` : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <p className="text-xs text-slate-500">
              Only drivers who are online, approved, in this district and holding an approved vehicle with
              valid registration and insurance are listed.
            </p>

            {selectedDriver && (
              <Field label="Vehicle">
                {selectedDriver.vehicles.length === 0 ? (
                  <p className="text-sm text-slate-500">This driver has no vehicles available.</p>
                ) : (
                  <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">Select a vehicle…</option>
                    {selectedDriver.vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {[v.make, v.model].filter(Boolean).join(' ') || v.type || 'Vehicle'}
                        {v.type ? ` · ${v.type}` : ''}
                        {v.licencePlate ? ` · ${v.licencePlate}` : ''}
                        {v.isPrimary ? ' (primary)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}

            {mode === 'reassign' && (
              <Field label="Reason">
                <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this leg being reassigned?" />
              </Field>
            )}

            {err && <p className="text-sm font-medium text-red-600">{err}</p>}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={submit} disabled={busy}>
                {busy ? 'Submitting…' : mode === 'assign' ? 'Assign' : 'Reassign'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

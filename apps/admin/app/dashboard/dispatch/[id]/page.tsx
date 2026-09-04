'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, type ApiError } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { Alert, Badge, Button, Field, PageHeader, Select, Spinner, Textarea } from '../../../../components/ui';
import { adminCrumbs } from '../../../../lib/admin-nav';
import {
  addressLines,
  byFewestActiveJobs,
  canAssign,
  canReassign,
  money,
  vehicleSummary,
  type AssignedVehicle,
  type PostalAddress,
} from '../../../../lib/dispatch';

interface Eligibility {
  eligible: boolean;
  reasons: string[];
}

interface DetailVehicle {
  id: string;
  type: string;
  make: string;
  model: string;
  licencePlate: string;
  isPrimary: boolean;
}

interface DetailDriver {
  displayName: string | null;
  ratingAverage: number | null;
  completedDeliveries: number | null;
}

interface DeliveryItem {
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
}

interface PickupLocation {
  label: string | null;
  addressLine1: string | null;
  city: string | null;
  district: string | null;
}

interface TimelineEntry {
  event: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorRole: string | null;
  note: string | null;
  createdAt: string;
}

interface AssignmentHistoryEntry {
  id: string;
  driver: string | null;
  status: string;
  assignedAt: string | null;
  respondedAt: string | null;
  endedAt: string | null;
  declineReason: string | null;
  endReason: string | null;
}

interface DeliveryDetail {
  id: string;
  status: string;
  statusLabel: string;
  orderNumber: string;
  vendorOrderNumber: string | null;
  vendor: { businessName: string; slug: string } | null;
  orderStatus: string | null;
  deliveryAddress: PostalAddress | null;
  pickupLocation: PickupLocation | null;
  recipientName: string | null;
  timestamps: Record<string, string | null> | null;
  feeMinor: number | null;
  items: DeliveryItem[];
  driver: DetailDriver | null;
  vehicle: AssignedVehicle | null;
  currentDriverEligibility: Eligibility | null;
  payment: { status: string; amountMinor: number; currency: string } | null;
  timeline: TimelineEntry[];
  assignmentHistory: AssignmentHistoryEntry[];
  podPhotoUrls: string[] | null;
  createdAt: string;
}

interface EligibleDriver {
  driverProfileId: string;
  displayName: string | null;
  name: string;
  homeDistrict: string | null;
  availability: string | null;
  completedDeliveries: number | null;
  activeJobs: number | null;
  ratingAverage: number | null;
  vehicles: DetailVehicle[];
}

interface Pins {
  pickupPin: string;
  deliveryPin: string;
  pickupVerificationStatus: string | null;
  deliveryVerificationStatus: string | null;
}

export default function DispatchDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.get<DeliveryDetail>(`/admin/deliveries/${id}`));
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 403 ? 'You do not have permission to view this delivery.' : err.message ?? 'Failed to load delivery.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/dashboard/dispatch" className="text-sm font-medium text-belize-blue hover:underline">
        ← Dispatch
      </Link>

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}

      {!loading && error && (
        <p className="mt-6 rounded-bmpl-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {!loading && detail && <DetailView detail={detail} id={id} onChanged={load} />}
    </div>
  );
}

function DetailView({ detail: d, id, onChanged }: { detail: DeliveryDetail; id: string; onChanged: () => void }) {
  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs(['Dispatch', '/dashboard/dispatch'], `Order ${d.orderNumber}`)}
        eyebrow="Delivery"
        title={`Order ${d.orderNumber}`}
        actions={<StatusBadge status={d.status} />}
      />

      <Alert tone="info" className="mb-6">
        <span className="font-semibold">{d.statusLabel}</span>
        {d.vendorOrderNumber ? ` · Vendor order ${d.vendorOrderNumber}` : ''}
      </Alert>

      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard title="Order & vendor">
          <Row label="Order number">{d.orderNumber}</Row>
          <Row label="Vendor order">{d.vendorOrderNumber ?? '—'}</Row>
          <Row label="Vendor">{d.vendor?.businessName ?? '—'}</Row>
          <Row label="Order status">{d.orderStatus ? <StatusBadge status={d.orderStatus} /> : '—'}</Row>
          <Row label="Fee">{money(d.feeMinor)}</Row>
          <Row label="Created">{new Date(d.createdAt).toLocaleString()}</Row>
        </InfoCard>

        <InfoCard title="Delivery address">
          <Row label="Recipient">{d.deliveryAddress?.fullName ?? d.recipientName ?? '—'}</Row>
          <Row label="Contact">{d.deliveryAddress?.phone ?? '—'}</Row>
          <Row label="Address">{addressLines(d.deliveryAddress)}</Row>
          <Row label="District">{d.deliveryAddress?.district ? d.deliveryAddress.district.replace(/_/g, ' ') : '—'}</Row>
          <Row label="City">{d.deliveryAddress?.city ?? '—'}</Row>
        </InfoCard>

        <InfoCard title="Collect from">
          <Row label="Location">{d.pickupLocation?.label ?? '—'}</Row>
          <Row label="Address">{d.pickupLocation?.addressLine1 ?? '—'}</Row>
          <Row label="City">{d.pickupLocation?.city ?? '—'}</Row>
          <Row label="District">{d.pickupLocation?.district ? d.pickupLocation.district.replace(/_/g, ' ') : '—'}</Row>
        </InfoCard>

        <InfoCard title="Payment (read-only)">
          {d.payment ? (
            <>
              <Row label="Status">
                <StatusBadge status={d.payment.status} />
              </Row>
              <Row label="Amount">
                {money(d.payment.amountMinor)} {d.payment.currency}
              </Row>
            </>
          ) : (
            <p className="text-sm text-slate-400">No payment record.</p>
          )}
        </InfoCard>

        <InfoCard title="Items">
          {d.items.length === 0 ? (
            <p className="text-sm text-slate-400">No items.</p>
          ) : (
            <ul className="space-y-1">
              {d.items.map((it, i) => (
                <li key={i} className="flex justify-between text-sm text-slate-600">
                  <span>
                    {it.quantity}× {it.productTitle}
                    {it.variantTitle ? ` · ${it.variantTitle}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </InfoCard>
      </div>

      <InfoCard title="Current driver" className="mt-6">
        {d.driver ? (
          <>
            <Row label="Driver">{d.driver.displayName ?? '—'}</Row>
            <Row label="Vehicle">{vehicleSummary(d.vehicle)}</Row>
            <Row label="Completed deliveries">{d.driver.completedDeliveries ?? 0}</Row>
          </>
        ) : (
          <p className="text-sm text-slate-400">No driver assigned.</p>
        )}
        {d.currentDriverEligibility && !d.currentDriverEligibility.eligible && (
          <Alert tone="warning" title="Driver not currently eligible" className="mt-3">
            <ul className="ml-4 list-disc space-y-0.5">
              {d.currentDriverEligibility.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Alert>
        )}
      </InfoCard>

      <AssignmentPanel detail={d} id={id} onChanged={onChanged} />

      <PinPanel id={id} />

      <InfoCard title="Proof of delivery" className="mt-6">
        {d.podPhotoUrls && d.podPhotoUrls.length > 0 ? (
          <>
            <Row label="Recipient">{d.recipientName ?? '—'}</Row>
            <Row label="Delivered at">{d.timestamps?.deliveredAt ? new Date(d.timestamps.deliveredAt).toLocaleString() : '—'}</Row>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.podPhotoUrls.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={url}
                  alt={`Proof of delivery ${i + 1}`}
                  className="h-20 w-20 rounded-bmpl-md border border-slate-200 object-cover"
                />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">No proof of delivery on file.</p>
        )}
      </InfoCard>

      <InfoCard title="Timeline" className="mt-6">
        {d.timeline.length === 0 ? (
          <p className="text-sm text-slate-400">No timeline events.</p>
        ) : (
          <ol className="space-y-3">
            {d.timeline.map((t, i) => (
              <li key={i} className="relative border-l-2 border-slate-200 pl-4">
                <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-belize-blue" aria-hidden />
                <p className="text-sm font-medium text-belize-navy">
                  {t.event.replace(/_/g, ' ')}
                  {(t.fromStatus || t.toStatus) && (
                    <span className="ml-1 text-xs font-normal text-slate-500">
                      {t.fromStatus ? `${t.fromStatus.replace(/_/g, ' ')} → ` : ''}
                      {t.toStatus ? t.toStatus.replace(/_/g, ' ') : ''}
                    </span>
                  )}
                </p>
                {t.note && <p className="text-xs text-slate-600">{t.note}</p>}
                <p className="text-xs text-slate-400">
                  {t.actorRole ? `${t.actorRole} · ` : ''}
                  {new Date(t.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ol>
        )}
      </InfoCard>

      <InfoCard title="Assignment history" className="mt-6">
        {d.assignmentHistory.length === 0 ? (
          <p className="text-sm text-slate-400">No assignment history.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Driver</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Assigned</th>
                  <th className="py-2 pr-3">Responded</th>
                  <th className="py-2 pr-3">Ended</th>
                  <th className="py-2 pr-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {d.assignmentHistory.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 text-slate-600">{a.driver ?? '—'}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{a.assignedAt ? new Date(a.assignedAt).toLocaleString() : '—'}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{a.respondedAt ? new Date(a.respondedAt).toLocaleString() : '—'}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{a.endedAt ? new Date(a.endedAt).toLocaleString() : '—'}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{a.declineReason ?? a.endReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </InfoCard>
    </div>
  );
}

function AssignmentPanel({ detail: d, id, onChanged }: { detail: DeliveryDetail; id: string; onChanged: () => void }) {
  const [mode, setMode] = useState<'assign' | 'reassign' | 'cancel' | null>(null);

  const assignAllowed = canAssign(d.status);
  const reassignAllowed = canReassign(d.status);

  if (!assignAllowed && !reassignAllowed) return null;

  return (
    <InfoCard title="Assignment" className="mt-6">
      <div className="flex flex-wrap gap-2">
        {assignAllowed && (
          <Button size="sm" variant="primary" onClick={() => setMode('assign')}>
            Assign driver
          </Button>
        )}
        {reassignAllowed && (
          <>
            <Button size="sm" variant="outline" onClick={() => setMode('reassign')}>
              Reassign
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setMode('cancel')}>
              Cancel delivery
            </Button>
          </>
        )}
      </div>

      {(mode === 'assign' || mode === 'reassign') && (
        <AssignModal id={id} mode={mode} onClose={() => setMode(null)} onDone={onChanged} />
      )}
      {mode === 'cancel' && <CancelModal id={id} onClose={() => setMode(null)} onDone={onChanged} />}
    </InfoCard>
  );
}

function AssignModal({
  id,
  mode,
  onClose,
  onDone,
}: {
  id: string;
  mode: 'assign' | 'reassign';
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
        const list = await api.get<EligibleDriver[]>(`/admin/deliveries/${id}/eligible-drivers`);
        if (active) setDrivers(list);
      } catch (e) {
        const ex = e as ApiError;
        if (active) setLoadErr(ex.status === 403 ? 'You do not have permission to assign drivers.' : ex.message ?? 'Failed to load drivers.');
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const selectedDriver = drivers?.find((dr) => dr.driverProfileId === driverId) ?? null;

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
        await api.post(`/admin/deliveries/${id}/assign`, { driverProfileId: driverId, vehicleId });
      } else {
        await api.post(`/admin/deliveries/${id}/reassign`, { driverProfileId: driverId, vehicleId, reason: reason.trim() });
      }
      onDone();
      onClose();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === 'assign' ? 'Assign driver' : 'Reassign driver'} onClose={onClose}>
      {loadErr ? (
        <p className="rounded-bmpl-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadErr}</p>
      ) : drivers === null ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading eligible drivers…
        </div>
      ) : drivers.length === 0 ? (
        <p className="text-sm text-slate-500">No eligible drivers available for this delivery.</p>
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
              {/* Least busy first. Everyone in this list is already online,
                  approved, licensed, in-district and driving an approved vehicle
                  with valid documents — the API filters on all of that — so the
                  only thing left for the operator to weigh is current load. */}
              {[...drivers]
                .sort(byFewestActiveJobs)
                .map((dr) => (
                  <option key={dr.driverProfileId} value={dr.driverProfileId}>
                    {dr.displayName || dr.name}
                    {` · ${dr.activeJobs ?? 0} live job${(dr.activeJobs ?? 0) === 1 ? '' : 's'}`}
                    {dr.homeDistrict ? ` · ${dr.homeDistrict.replace(/_/g, ' ')}` : ''}
                    {dr.completedDeliveries != null ? ` · ${dr.completedDeliveries} done` : ''}
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
                      {v.make} {v.model} · {v.type} · {v.licencePlate}
                      {v.isPrimary ? ' (primary)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {mode === 'reassign' && (
            <Field label="Reason">
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this delivery being reassigned?" />
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
    </Modal>
  );
}

function CancelModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setErr('A reason is required to cancel.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/admin/deliveries/${id}/cancel`, { reason: reason.trim() });
      onDone();
      onClose();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Cancel delivery" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Reason">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this delivery being cancelled?" />
        </Field>
        {err && <p className="text-sm font-medium text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button size="sm" variant="destructive" onClick={submit} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel delivery'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PinPanel({ id }: { id: string }) {
  const [pins, setPins] = useState<Pins | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setErr(null);
    try {
      setPins(await api.get<Pins>(`/admin/deliveries/${id}/pins`));
    } catch (e) {
      const ex = e as ApiError;
      setErr(ex.status === 403 ? 'You do not have permission to reveal PINs.' : ex.message ?? 'Failed to load PINs.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <InfoCard title="Verification PINs" className="mt-6">
      {!pins ? (
        <>
          <p className="mb-3 text-sm text-slate-500">PINs are sensitive and hidden until revealed.</p>
          <Button size="sm" variant="outline" onClick={reveal} disabled={busy}>
            {busy ? 'Revealing…' : 'Reveal pickup/delivery PINs'}
          </Button>
          {err && <p className="mt-2 text-sm font-medium text-red-600">{err}</p>}
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-bmpl-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pickup PIN</p>
            <p className="font-mono text-lg font-semibold text-belize-navy">{pins.pickupPin}</p>
            {pins.pickupVerificationStatus && (
              <Badge tone="neutral" className="mt-1">
                {pins.pickupVerificationStatus.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
          <div className="rounded-bmpl-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery PIN</p>
            <p className="font-mono text-lg font-semibold text-belize-navy">{pins.deliveryPin}</p>
            {pins.deliveryVerificationStatus && (
              <Badge tone="neutral" className="mt-1">
                {pins.deliveryVerificationStatus.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
        </div>
      )}
    </InfoCard>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-bmpl-xl border border-slate-200 bg-white p-5 shadow-bmpl-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-belize-navy">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function InfoCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm ${className}`}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-sm text-slate-600">
      <span className="font-medium text-slate-500">{label}:</span> {children}
    </p>
  );
}

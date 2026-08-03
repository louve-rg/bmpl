'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, type ApiError } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { Badge, Button, Card, PageHeader, Spinner } from '../../../../components/ui';
import { adminCrumbs } from '../../../../lib/admin-nav';

type ExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | null;

interface Vehicle {
  id: string;
  type: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  licencePlate: string;
  registrationNumber: string | null;
  registrationExpiry: string | null;
  registrationExpiryStatus: ExpiryStatus;
  insuranceProvider: string | null;
  insuranceExpiry: string | null;
  insuranceExpiryStatus: ExpiryStatus;
  photoUrls: string[];
  isActive: boolean;
  isPrimary: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
}

interface DriverDetail {
  id: string;
  legalName: string;
  displayName: string | null;
  phone: string | null;
  homeDistrict: string | null;
  homeAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  licenceNumber: string | null;
  licenceExpiry: string | null;
  licenceExpiryStatus: ExpiryStatus;
  vehicleOwnership: string | null;
  availability: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE' | 'SUSPENDED';
  isActive: boolean;
  ratingAverage: number | null;
  completedDeliveries: number | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
  roleStatus: 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REVOKED' | null;
  vehicles: Vehicle[];
  serviceAreas: Array<{ district: string; isActive: boolean }>;
  recentActivity: Array<{ action: string; createdAt: string; actorId: string | null }>;
}

const AVAILABILITY_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'error'> = {
  ONLINE: 'success',
  OFFLINE: 'neutral',
  UNAVAILABLE: 'warning',
  SUSPENDED: 'error',
};

const EXPIRY_TONE: Record<string, 'success' | 'warning' | 'error'> = {
  VALID: 'success',
  EXPIRING_SOON: 'warning',
  EXPIRED: 'error',
};

export default function DriverDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [driver, setDriver] = useState<DriverDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDriver(await api.get<DriverDetail>(`/admin/drivers/${id}`));
    } catch (e) {
      setError((e as ApiError).message ?? 'Failed to load driver.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/dashboard/drivers" className="text-sm font-medium text-belize-blue hover:underline">
        ← Drivers
      </Link>

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}

      {!loading && error && (
        <p className="mt-6 rounded-bmpl-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {!loading && driver && <DriverDetailView driver={driver} onChanged={load} />}
    </div>
  );
}

function DriverDetailView({ driver: d, onChanged }: { driver: DriverDetail; onChanged: () => void }) {
  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs(['Drivers', '/dashboard/drivers'], d.displayName || d.legalName)}
        title={d.displayName || d.legalName}
        eyebrow="Driver"
        actions={
          <>
            {d.roleStatus ? <StatusBadge status={d.roleStatus} /> : <Badge tone="neutral">No role</Badge>}
            <Badge tone={AVAILABILITY_TONE[d.availability] ?? 'neutral'}>{d.availability}</Badge>
          </>
        }
      />
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        Approve/suspend the driver role from the{' '}
        <Link href="/dashboard/applications" className="font-medium text-belize-blue hover:underline">
          Applications
        </Link>{' '}
        / Users area.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard title="Profile">
          <Row label="Legal name">{d.legalName}</Row>
          <Row label="Account">
            {d.user.name} ({d.user.email})
          </Row>
          <Row label="Phone">{d.phone ?? '—'}</Row>
          <Row label="Home district">{d.homeDistrict ? d.homeDistrict.replace(/_/g, ' ') : '—'}</Row>
          <Row label="Home address">{d.homeAddress ?? '—'}</Row>
          <Row label="Emergency contact">
            {d.emergencyContactName ?? '—'}
            {d.emergencyContactPhone ? ` · ${d.emergencyContactPhone}` : ''}
          </Row>
          <Row label="Vehicle ownership">{d.vehicleOwnership ?? '—'}</Row>
          <Row label="Rating">{d.ratingAverage != null ? d.ratingAverage.toFixed(1) : '—'}</Row>
          <Row label="Completed deliveries">{d.completedDeliveries ?? '—'}</Row>
          <Row label="Joined">{new Date(d.createdAt).toLocaleDateString()}</Row>
        </InfoCard>

        <InfoCard title="Licence">
          <Row label="Number">{d.licenceNumber ?? '—'}</Row>
          <Row label="Expiry">
            {d.licenceExpiry ? new Date(d.licenceExpiry).toLocaleDateString() : '—'}
            {d.licenceExpiryStatus && (
              <Badge tone={EXPIRY_TONE[d.licenceExpiryStatus]} className="ml-2">
                {d.licenceExpiryStatus.replace(/_/g, ' ')}
              </Badge>
            )}
          </Row>
        </InfoCard>

        <InfoCard title="Service areas" className="md:col-span-2">
          {d.serviceAreas.length === 0 && <p className="text-sm text-slate-400">None</p>}
          <div className="flex flex-wrap gap-2">
            {d.serviceAreas.map((s) => (
              <Badge key={s.district} tone={s.isActive ? 'brand' : 'neutral'}>
                {s.district.replace(/_/g, ' ')}
                {!s.isActive && ' (inactive)'}
              </Badge>
            ))}
          </div>
        </InfoCard>
      </div>

      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Vehicles ({d.vehicles.length})
      </h2>
      {d.vehicles.length === 0 ? (
        <p className="text-sm text-slate-400">No vehicles on file.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {d.vehicles.map((v) => (
            <VehicleCard key={v.id} vehicle={v} onChanged={onChanged} />
          ))}
        </div>
      )}

      <InfoCard title="Recent activity" className="mt-6">
        {d.recentActivity.length === 0 && <p className="text-sm text-slate-400">No recent activity.</p>}
        <ol className="space-y-2">
          {d.recentActivity.map((a, i) => (
            <li key={i} className="text-sm text-slate-600">
              <span className="font-medium text-belize-navy">{a.action}</span> ·{' '}
              {new Date(a.createdAt).toLocaleString()}
            </li>
          ))}
        </ol>
      </InfoCard>
    </div>
  );
}

function VehicleCard({ vehicle: v, onChanged }: { vehicle: Vehicle; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await api.post(`/admin/drivers/vehicles/${v.id}/approve`, {});
      onChanged();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    const reason = window.prompt('Reason to reject:') ?? '';
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/drivers/vehicles/${v.id}/reject`, { reason });
      onChanged();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-belize-navy">
            {v.year ? `${v.year} ` : ''}
            {v.make} {v.model}
            {v.isPrimary && <span className="ml-1.5 text-xs font-normal text-emerald-600">(primary)</span>}
          </p>
          <p className="text-xs text-slate-500">
            {v.type} · {v.color ?? '—'} · plate {v.licencePlate}
          </p>
        </div>
        <StatusBadge status={v.approvalStatus} />
      </div>

      <Row label="Registration">
        {v.registrationNumber ?? '—'}
        {v.registrationExpiry ? ` · exp. ${new Date(v.registrationExpiry).toLocaleDateString()}` : ''}
        {v.registrationExpiryStatus && (
          <Badge tone={EXPIRY_TONE[v.registrationExpiryStatus]} className="ml-2">
            {v.registrationExpiryStatus.replace(/_/g, ' ')}
          </Badge>
        )}
      </Row>
      <Row label="Insurance">
        {v.insuranceProvider ?? '—'}
        {v.insuranceExpiry ? ` · exp. ${new Date(v.insuranceExpiry).toLocaleDateString()}` : ''}
        {v.insuranceExpiryStatus && (
          <Badge tone={EXPIRY_TONE[v.insuranceExpiryStatus]} className="ml-2">
            {v.insuranceExpiryStatus.replace(/_/g, ' ')}
          </Badge>
        )}
      </Row>
      <Row label="Active">{v.isActive ? 'Yes' : 'No'}</Row>
      {v.rejectionReason && (
        <p className="mt-1 text-sm text-red-600">Rejection reason: {v.rejectionReason}</p>
      )}

      {v.photoUrls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {v.photoUrls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={url}
              alt={`${v.make} ${v.model} photo ${i + 1}`}
              className="h-16 w-16 rounded-bmpl-md border border-slate-200 object-cover"
            />
          ))}
        </div>
      )}

      {v.approvalStatus === 'PENDING' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={approve} disabled={busy}>
            Approve
          </Button>
          <Button size="sm" variant="destructive" onClick={reject} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
    </Card>
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

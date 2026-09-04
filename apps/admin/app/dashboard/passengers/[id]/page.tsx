'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, type ApiError } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { Badge, Button, Card, PageHeader, Spinner } from '../../../../components/ui';
import { adminCrumbs } from '../../../../lib/admin-nav';

/**
 * One passenger driver: the vetting screen.
 *
 * Vehicle approve/reject is the whole point — without it the S1 chain ends
 * with a registered driver nobody can clear to carry anyone. Role approval
 * itself stays in Applications/Users, same as delivery drivers. No fares,
 * no booking: S3 does not exist yet and this screen does not pretend it does.
 */

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
  seatCapacity: number | null;
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
  availability: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE' | 'SUSPENDED';
  isActive: boolean;
  isTest: boolean;
  ratingAverage: number | null;
  completedTrips: number | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
  roleStatus: 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REVOKED' | null;
  provider: { id: string; businessName: string } | null;
  vehicles: Vehicle[];
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

export default function PassengerDriverDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [driver, setDriver] = useState<DriverDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Optimistic until a 403 proves the viewer holds passengers.read alone;
  // /me carries no permission list, so the guard is the only oracle.
  const [canModerate, setCanModerate] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDriver(await api.get<DriverDetail>(`/admin/passengers/drivers/${id}`));
    } catch (e) {
      setError((e as ApiError).message ?? 'Failed to load this driver.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/dashboard/passengers" className="text-sm font-medium text-belize-blue hover:underline">
        ← Passengers
      </Link>

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}

      {!loading && error && (
        <p className="mt-6 rounded-bmpl-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {!loading && driver && (
        <DriverDetailView
          driver={driver}
          onChanged={load}
          canModerate={canModerate}
          onForbidden={() => setCanModerate(false)}
        />
      )}
    </div>
  );
}

function DriverDetailView({
  driver: d,
  onChanged,
  canModerate,
  onForbidden,
}: {
  driver: DriverDetail;
  onChanged: () => void;
  canModerate: boolean;
  onForbidden: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggleTestMode() {
    const reason = window.prompt(
      `Why is this driver ${d.isTest ? 'leaving' : 'entering'} simulation mode? (recorded in the audit log)`,
    )?.trim();
    if (!reason || reason.length < 4) return;
    setBusy(true);
    try {
      await api.patch(`/admin/passengers/drivers/${d.id}/test-mode`, { isTest: !d.isTest, reason });
      onChanged();
    } catch (e) {
      const ex = e as ApiError;
      if (ex.status === 403) onForbidden();
      else window.alert(ex.message ?? 'Could not change test mode.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs(['Passengers', '/dashboard/passengers'], d.displayName || d.legalName)}
        title={d.displayName || d.legalName}
        eyebrow="Passenger driver"
        actions={
          <>
            {d.roleStatus ? <StatusBadge status={d.roleStatus} /> : <Badge tone="neutral">No role</Badge>}
            <Badge tone={AVAILABILITY_TONE[d.availability] ?? 'neutral'}>{d.availability}</Badge>
            {d.isTest && <Badge tone="neutral">Simulation</Badge>}
          </>
        }
      />
      <p className="-mt-4 mb-6 text-sm text-slate-500">
        Approve/suspend the passenger-driver role from the{' '}
        <Link href="/dashboard/applications" className="font-medium text-belize-blue hover:underline">
          Applications
        </Link>{' '}
        / Users area. Vehicles are cleared below.
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
          <Row label="Operates for">
            {d.provider ? d.provider.businessName : 'Independent'}
          </Row>
          <Row label="Rating">{d.ratingAverage != null ? d.ratingAverage.toFixed(1) : '—'}</Row>
          <Row label="Completed trips">{d.completedTrips ?? '—'}</Row>
          <Row label="Joined">{new Date(d.createdAt).toLocaleDateString()}</Row>
        </InfoCard>

        <InfoCard title="Licence & simulation">
          <Row label="Licence number">{d.licenceNumber ?? '—'}</Row>
          <Row label="Licence expiry">
            {d.licenceExpiry ? new Date(d.licenceExpiry).toLocaleDateString() : '—'}
            {d.licenceExpiryStatus && (
              <Badge tone={EXPIRY_TONE[d.licenceExpiryStatus]} className="ml-2">
                {d.licenceExpiryStatus.replace(/_/g, ' ')}
              </Badge>
            )}
          </Row>
          <Row label="Simulation">{d.isTest ? 'Yes — never offered real passengers' : 'No'}</Row>
          {canModerate && (
            <Button size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => void toggleTestMode()}>
              {d.isTest ? 'Make real' : 'Make simulation'}
            </Button>
          )}
        </InfoCard>
      </div>

      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Vehicles ({d.vehicles.length})
      </h2>
      {d.vehicles.length === 0 ? (
        <p className="text-sm text-slate-400">No vehicles on file — nothing to clear yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {d.vehicles.map((v) => (
            <VehicleCard key={v.id} vehicle={v} onChanged={onChanged} canModerate={canModerate} onForbidden={onForbidden} />
          ))}
        </div>
      )}
    </div>
  );
}

function VehicleCard({
  vehicle: v,
  onChanged,
  canModerate,
  onForbidden,
}: {
  vehicle: Vehicle;
  onChanged: () => void;
  canModerate: boolean;
  onForbidden: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function act(action: 'approve' | 'reject') {
    let reason: string | undefined;
    if (action === 'reject') {
      reason = window.prompt('Reason to reject (the driver sees this):')?.trim();
      if (!reason) return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/passengers/vehicles/${v.id}/${action}`, reason ? { reason } : {});
      onChanged();
    } catch (e) {
      const ex = e as ApiError;
      if (ex.status === 403) onForbidden();
      else window.alert(ex.message ?? 'Action failed.');
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
            {v.seatCapacity != null ? ` · ${v.seatCapacity} seats` : ''}
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
      {v.rejectionReason && <p className="mt-1 text-sm text-red-600">Rejection reason: {v.rejectionReason}</p>}

      {canModerate && v.approvalStatus === 'PENDING' && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => void act('approve')} disabled={busy}>
            Approve
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void act('reject')} disabled={busy}>
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

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { loadErrorMessage } from '../../../lib/load-error';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, Badge, EmptyState, Field, PageHeader, Select, Spinner } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

interface DriverRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  displayName: string | null;
  homeDistrict: string | null;
  availability: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE' | 'SUSPENDED';
  roleStatus: 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REVOKED' | null;
  isActive: boolean;
  vehicleCount: number;
  approvedVehicles: number;
  serviceDistricts: string[];
  hasExpiredDocs: boolean;
  createdAt: string;
}

const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'];
const AVAILABILITIES = ['OFFLINE', 'ONLINE', 'UNAVAILABLE', 'SUSPENDED'];
const ROLE_STATUSES = ['PENDING', 'APPROVED', 'SUSPENDED', 'REVOKED'];

const AVAILABILITY_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'error'> = {
  ONLINE: 'success',
  OFFLINE: 'neutral',
  UNAVAILABLE: 'warning',
  SUSPENDED: 'error',
};

export default function DriversPage() {
  const [district, setDistrict] = useState('');
  const [availability, setAvailability] = useState('');
  const [roleStatus, setRoleStatus] = useState('');
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(d: string, a: string, r: string) {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (d) params.set('district', d);
      if (a) params.set('availability', a);
      if (r) params.set('roleStatus', r);
      const qs = params.toString();
      setRows(await api.get<DriverRow[]>(`/admin/drivers${qs ? `?${qs}` : ''}`));
    } catch (e) {
      setErr(loadErrorMessage(e, 'drivers'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(district, availability, roleStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district, availability, roleStatus]);

  return (
    <div>
      <PageHeader breadcrumbs={adminCrumbs('Drivers')} eyebrow="Logistics" title="Drivers" />

      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Field label="District">
          <Select value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">All districts</option>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {d.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Availability">
          <Select value={availability} onChange={(e) => setAvailability(e.target.value)}>
            <option value="">All availability</option>
            {AVAILABILITIES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Role status">
          <Select value={roleStatus} onChange={(e) => setRoleStatus(e.target.value)}>
            <option value="">All statuses</option>
            {ROLE_STATUSES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No drivers found" description="Try adjusting the filters above." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Display name</th>
                <th className="px-4 py-3">Home district</th>
                <th className="px-4 py-3">Role status</th>
                <th className="px-4 py-3">Availability</th>
                <th className="px-4 py-3">Vehicles</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-belize-navy">{d.name}</p>
                    <p className="text-xs text-slate-500">{d.email}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{d.displayName ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {d.homeDistrict ? d.homeDistrict.replace(/_/g, ' ') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {d.roleStatus ? <StatusBadge status={d.roleStatus} /> : <Badge tone="neutral">—</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={AVAILABILITY_TONE[d.availability] ?? 'neutral'}>{d.availability}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {d.approvedVehicles}/{d.vehicleCount}
                      {d.hasExpiredDocs && <Badge tone="error">Expired docs</Badge>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/drivers/${d.id}`} className="font-semibold text-belize-blue hover:underline">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

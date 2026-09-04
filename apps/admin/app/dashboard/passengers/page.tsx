'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, Badge, Button, EmptyState, Field, PageHeader, Select, Spinner } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

/**
 * Passenger transportation oversight — the supply side only.
 *
 * S1/S2 scope: vetting people and vehicles, and SEEING the network operators
 * have declared. There is deliberately no booking, no trip creation and no
 * fare anywhere on this screen: pricing and rider-facing behaviour are S3,
 * gated on a product decision that has not been made. The API returns
 * baseFareMinor as null by design and this console does not mention price
 * at all rather than showing an empty column.
 *
 * passengers.read looks; passengers.moderate acts. /me does not expose the
 * caller's permissions, so — like the marketing console — action controls
 * show until the first 403 proves the viewer is read-only, then hide for
 * the rest of the visit.
 */

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
  isTest: boolean;
  vehicleCount: number;
  approvedVehicles: number;
  hasExpiredDocs: boolean;
  createdAt: string;
}

type ExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | null;

interface ProviderRow {
  id: string;
  userId: string;
  businessName: string;
  contactName: string;
  accountEmail: string;
  contactEmail: string | null;
  contactPhone: string | null;
  district: string | null;
  city: string | null;
  operatingLicenceNumber: string | null;
  operatingLicenceExpiry: string | null;
  operatingLicenceExpiryStatus: ExpiryStatus;
  roleStatus: 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REVOKED' | null;
  isActive: boolean;
  isTest: boolean;
  vehicleCount: number;
  approvedVehicles: number;
  driverCount: number;
}

interface RouteStop {
  id: string;
  sequence: number;
  district: string;
  city: string;
  name: string | null;
}

interface RouteRow {
  id: string;
  name: string;
  description: string | null;
  originDistrict: string;
  originCity: string;
  destinationDistrict: string;
  destinationCity: string;
  scheduleNote: string | null;
  durationMinutes: number | null;
  isActive: boolean;
  isTest: boolean;
  stops?: RouteStop[];
  provider?: { id: string; businessName: string };
  tripCount?: number;
}

interface TripRow {
  id: string;
  reference: string;
  kind: string;
  status: string;
  isTest: boolean;
  routeName: string | null;
  providerName: string | null;
  scheduledDepartureAt: string | null;
  scheduledArrivalAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'];
const AVAILABILITIES = ['OFFLINE', 'ONLINE', 'UNAVAILABLE', 'SUSPENDED'];
const ROLE_STATUSES = ['PENDING', 'APPROVED', 'SUSPENDED', 'REVOKED'];
const TRIP_STATUSES = [
  'SCHEDULED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP',
  'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXCEPTION',
];

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

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

type Tab = 'drivers' | 'providers' | 'routes' | 'departures';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'drivers', label: 'Drivers' },
  { key: 'providers', label: 'Providers' },
  { key: 'routes', label: 'Routes' },
  { key: 'departures', label: 'Departures' },
];

export default function PassengersPage() {
  const [tab, setTab] = useState<Tab>('drivers');

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs('Passengers')}
        title="Passengers"
        description="Vetting the people and vehicles that will carry passengers, and the routes operators have declared. No booking exists yet."
      />

      <div className="mb-5 flex flex-wrap gap-1 rounded-bmpl-lg border border-slate-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-bmpl-md px-3 py-2 text-sm font-medium ${
              tab === t.key ? 'bg-belize-navy text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'drivers' && <DriversTab />}
      {tab === 'providers' && <ProvidersTab />}
      {tab === 'routes' && <RoutesTab />}
      {tab === 'departures' && <DeparturesTab />}
    </div>
  );
}

/* ------------------------------------------------------------- drivers */

function DriversTab() {
  const [district, setDistrict] = useState('');
  const [availability, setAvailability] = useState('');
  const [roleStatus, setRoleStatus] = useState('');
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (district) params.set('district', district);
    if (availability) params.set('availability', availability);
    if (roleStatus) params.set('roleStatus', roleStatus);
    const qs = params.toString();
    api
      .get<DriverRow[]>(`/admin/passengers/drivers${qs ? `?${qs}` : ''}`)
      .then((list) => {
        if (!cancelled) {
          setRows(list);
          setErr(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr((e as ApiError).message ?? 'Could not load passenger drivers.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [district, availability, roleStatus]);

  return (
    <div>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Field label="District">
          <Select value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">All districts</option>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>
            ))}
          </Select>
        </Field>
        <Field label="Availability">
          <Select value={availability} onChange={(e) => setAvailability(e.target.value)}>
            <option value="">All availability</option>
            {AVAILABILITIES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field label="Role status">
          <Select value={roleStatus} onChange={(e) => setRoleStatus(e.target.value)}>
            <option value="">All statuses</option>
            {ROLE_STATUSES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
      </div>

      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}
      {loading ? (
        <Loading />
      ) : rows.length === 0 && !err ? (
        <EmptyState
          title="No passenger drivers"
          description="Nobody has registered as a passenger driver yet, or nothing matches the filters."
        />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
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
                    <p className="font-medium text-belize-navy">
                      {d.displayName || d.name}
                      {d.isTest && <Badge tone="neutral" className="ml-1.5">Simulation</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">{d.email}</p>
                  </td>
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
                      {d.approvedVehicles}/{d.vehicleCount} approved
                      {d.hasExpiredDocs && <Badge tone="error">Expired docs</Badge>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/passengers/${d.id}`} className="font-semibold text-belize-blue hover:underline">
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

/* ----------------------------------------------------------- providers */

function ProvidersTab() {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [canModerate, setCanModerate] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<ProviderRow[]>('/admin/passengers/providers'));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load providers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleTestMode(p: ProviderRow) {
    const reason = window.prompt(
      `Why is ${p.businessName} ${p.isTest ? 'leaving' : 'entering'} simulation mode? (recorded in the audit log)`,
    )?.trim();
    if (!reason || reason.length < 4) return;
    setBusy(p.id);
    setNote(null);
    try {
      await api.patch(`/admin/passengers/providers/${p.id}/test-mode`, { isTest: !p.isTest, reason });
      setNote(`${p.businessName} is now a ${p.isTest ? 'real' : 'simulation'} operator.`);
      await load();
    } catch (e) {
      const ex = e as ApiError;
      if (ex.status === 403) setCanModerate(false);
      else setErr(ex.message ?? 'Could not change test mode.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}
      {note && <Alert tone="success" className="mb-4">{note}</Alert>}
      {loading ? (
        <Loading />
      ) : rows.length === 0 && !err ? (
        <EmptyState title="No providers" description="No passenger transport provider has registered yet." />
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <div key={p.id} className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-belize-navy">{p.businessName}</span>
                    {p.roleStatus ? <StatusBadge status={p.roleStatus} /> : <Badge tone="neutral">No role</Badge>}
                    <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                    {p.isTest && <Badge tone="neutral">Simulation</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {p.contactName} · {p.accountEmail}
                    {p.contactPhone ? ` · ${p.contactPhone}` : ''}
                    {p.city ? ` · ${p.city}${p.district ? `, ${p.district.replace(/_/g, ' ')}` : ''}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {p.driverCount} driver{p.driverCount === 1 ? '' : 's'} · {p.approvedVehicles}/{p.vehicleCount} vehicles approved
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Operating licence: {p.operatingLicenceNumber ?? '—'}
                    {p.operatingLicenceExpiry ? ` · exp. ${new Date(p.operatingLicenceExpiry).toLocaleDateString()}` : ''}
                    {p.operatingLicenceExpiryStatus && (
                      <Badge tone={EXPIRY_TONE[p.operatingLicenceExpiryStatus]} className="ml-1.5">
                        {p.operatingLicenceExpiryStatus.replace(/_/g, ' ')}
                      </Badge>
                    )}
                  </p>
                </div>
                {canModerate && (
                  <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => void toggleTestMode(p)}>
                    {p.isTest ? 'Make real' : 'Make simulation'}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- routes */

function RoutesTab() {
  const [rows, setRows] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [includeTest, setIncludeTest] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // The endpoint filters when asked; unfiltered shows both sides, which is
    // the useful oversight default while the network is being built out.
    api
      .get<RouteRow[]>(`/admin/passengers/routes${includeTest ? '' : '?isTest=false'}`)
      .then((list) => {
        if (!cancelled) {
          setRows(list);
          setErr(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr((e as ApiError).message ?? 'Could not load routes.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeTest]);

  return (
    <div>
      <label className="mb-4 flex min-h-[40px] items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
        Include simulation routes
      </label>
      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}
      {loading ? (
        <Loading />
      ) : rows.length === 0 && !err ? (
        <EmptyState
          title="No routes declared"
          description="Routes are declared by providers (or entered by admin on their behalf). None exist yet."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-belize-navy">{r.name}</span>
                <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
                {r.isTest && <Badge tone="neutral">Simulation</Badge>}
                {r.provider && <span className="text-xs text-slate-500">{r.provider.businessName}</span>}
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {r.originCity}, {r.originDistrict.replace(/_/g, ' ')} → {r.destinationCity},{' '}
                {r.destinationDistrict.replace(/_/g, ' ')}
                {r.durationMinutes != null ? ` · ~${r.durationMinutes} min` : ''}
                {r.tripCount != null ? ` · ${r.tripCount} departure${r.tripCount === 1 ? '' : 's'}` : ''}
              </p>
              {r.scheduleNote && <p className="mt-0.5 text-xs text-slate-500">{r.scheduleNote}</p>}
              {r.stops && r.stops.length > 0 && (
                <ol className="mt-2 flex flex-wrap gap-1.5 text-xs text-slate-600">
                  {r.stops.map((s) => (
                    <li key={s.id} className="rounded-bmpl-md border border-slate-200 px-2 py-0.5">
                      {s.sequence}. {s.name ? `${s.name}, ` : ''}{s.city}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- departures */

function DeparturesTab() {
  const [rows, setRows] = useState<TripRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<TripRow[]>(`/admin/passengers/trips${status ? `?status=${status}` : ''}`)
      .then((list) => {
        if (!cancelled) {
          setRows(list);
          setErr(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr((e as ApiError).message ?? 'Could not load departures.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <div>
      <div className="mb-4 max-w-xs">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {TRIP_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>
            ))}
          </Select>
        </Field>
      </div>
      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}
      {loading ? (
        <Loading />
      ) : rows.length === 0 && !err ? (
        <EmptyState
          title="No departures"
          description="No published departures match. Departures are published by providers; nothing here is bookable yet."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((t) => (
            <div key={t.id} className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-belize-navy">{t.reference}</span>
                <Badge tone={t.status === 'CANCELLED' || t.status === 'EXCEPTION' ? 'warning' : 'info'}>
                  {t.status.replace(/_/g, ' ').toLowerCase()}
                </Badge>
                <Badge tone="neutral">{t.kind.replace(/_/g, ' ').toLowerCase()}</Badge>
                {t.isTest && <Badge tone="neutral">Simulation</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {t.routeName ?? '—'}
                {t.providerName ? ` · ${t.providerName}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Departs {when(t.scheduledDepartureAt)}
                {t.scheduledArrivalAt ? ` · arrives ${when(t.scheduledArrivalAt)}` : ''}
              </p>
              {t.cancellationReason && (
                <p className="mt-1 text-xs font-medium text-amber-800">
                  Cancelled{t.cancelledAt ? ` ${when(t.cancelledAt)}` : ''}: {t.cancellationReason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <Spinner className="h-4 w-4" /> Loading…
    </div>
  );
}

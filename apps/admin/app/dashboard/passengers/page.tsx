'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, Badge, Button, EmptyState, Field, PageHeader, Select, Spinner } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

/**
 * Passenger transportation oversight.
 *
 * S1/S2: vetting people and vehicles, and seeing the network operators have
 * declared. S3 adds the booking lifecycle: seat requests, confirmation,
 * staffing a departure with a driver and vehicle, and movement states.
 *
 * Fares are rendered only as the API returns them, and the fail-closed rule
 * is surfaced, never softened: a route without a configured fare says so and
 * cannot produce a booking — the server refuses, and this console shows the
 * refusal state up front rather than offering a control that pretends
 * otherwise. Whether a fare is per seat or per booking is undecided
 * commercial policy, so no label here claims either.
 *
 * passengers.read looks; passengers.moderate acts. /me does not expose the
 * caller's permissions (BMPL-47), so — like the marketing console — action
 * controls show until the first 403 proves the viewer is read-only, then
 * hide for the rest of the visit.
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
  baseFareMinor: number | null;
  isActive: boolean;
  isTest: boolean;
  stops?: RouteStop[];
  provider?: { id: string; businessName: string };
  tripCount?: number;
}

interface BookingRow {
  id: string;
  reference: string;
  status: 'REQUESTED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'EXPIRED';
  seats: number;
  isTest: boolean;
  tripId: string | null;
  tripReference: string | null;
  tripStatus: string | null;
  scheduledDepartureAt: string | null;
  routeName: string | null;
  from: string | null;
  to: string | null;
  passengerName: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
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

type Tab = 'drivers' | 'providers' | 'routes' | 'departures' | 'bookings';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'drivers', label: 'Drivers' },
  { key: 'providers', label: 'Providers' },
  { key: 'routes', label: 'Routes' },
  { key: 'departures', label: 'Departures' },
  { key: 'bookings', label: 'Bookings' },
];

export default function PassengersPage() {
  const [tab, setTab] = useState<Tab>('drivers');

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs('Passengers')}
        title="Passengers"
        description="Vetting the people and vehicles that carry passengers, and overseeing the routes, departures and seat bookings operators run."
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
      {tab === 'bookings' && <BookingsTab />}
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
              {/* The fail-closed rule, surfaced: a booking on an unpriced route is
                  refused server-side, so the console says so here instead of
                  letting an operator discover it through rider complaints. The
                  fare deliberately carries no per-seat/per-booking unit — that
                  policy is undecided, and the label must not decide it. */}
              {r.baseFareMinor != null && r.baseFareMinor > 0 ? (
                <p className="mt-0.5 text-xs text-slate-600">Fare BZ${(r.baseFareMinor / 100).toFixed(2)}</p>
              ) : (
                <p className="mt-0.5 text-xs font-medium text-amber-700">
                  No fare configured — departures on this route cannot be booked until one is set.
                </p>
              )}
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
  const [canModerate, setCanModerate] = useState(true);
  const [assigning, setAssigning] = useState<TripRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<TripRow[]>(`/admin/passengers/trips${status ? `?status=${status}` : ''}`));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load departures.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

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
          description="No published departures match. Departures are published by providers."
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
                {/* Assignment moves a departure SCHEDULED → ASSIGNED, so a
                    SCHEDULED one is by definition still unstaffed — the same
                    rule assignTripAsAdmin enforces. */}
                {canModerate && t.status === 'SCHEDULED' && (
                  <button
                    type="button"
                    onClick={() => setAssigning(t)}
                    className="text-xs font-medium text-belize-blue hover:underline"
                  >
                    Assign driver &amp; vehicle
                  </button>
                )}
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

      {assigning && (
        <AssignTripModal
          trip={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            void load();
          }}
          onForbidden={() => {
            setAssigning(null);
            setCanModerate(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Staff a departure. There is no eligibility endpoint for passenger trips, so
 * the picker offers the whole driver directory and the SERVER is the
 * authority on every rule (own-fleet-only, approval, the test boundary, the
 * rider-cannot-drive check) — its refusals are shown verbatim. Vehicles are
 * limited to APPROVED and active ones, which is reading the same row fields
 * the server checks, not a second statement of the rule.
 */
function AssignTripModal({
  trip,
  onClose,
  onDone,
  onForbidden,
}: {
  trip: TripRow;
  onClose: () => void;
  onDone: () => void;
  onForbidden: () => void;
}) {
  const [drivers, setDrivers] = useState<DriverRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [driverId, setDriverId] = useState('');
  const [vehicles, setVehicles] = useState<Array<{ id: string; make: string; model: string; licencePlate: string; approvalStatus: string; isActive: boolean }> | null>(null);
  const [vehicleId, setVehicleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<DriverRow[]>('/admin/passengers/drivers')
      .then((list) => {
        if (!cancelled) setDrivers(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadErr((e as ApiError).message ?? 'Could not load drivers.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!driverId) {
      setVehicles(null);
      return;
    }
    let cancelled = false;
    setVehicles(null);
    setVehicleId('');
    api
      .get<{ vehicles: Array<{ id: string; make: string; model: string; licencePlate: string; approvalStatus: string; isActive: boolean }> }>(
        `/admin/passengers/drivers/${driverId}`,
      )
      .then((d) => {
        if (!cancelled) setVehicles(d.vehicles.filter((v) => v.approvalStatus === 'APPROVED' && v.isActive));
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr((e as ApiError).message ?? 'Could not load that driver.');
      });
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  async function submit() {
    if (!driverId || !vehicleId) {
      setErr('Choose a driver and a vehicle.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/admin/passengers/trips/${trip.id}/assign`, { driverProfileId: driverId, vehicleId });
      onDone();
    } catch (e) {
      const ex = e as ApiError;
      if (ex.status === 403) onForbidden();
      else {
        setErr(ex.message ?? 'Could not assign.');
        setBusy(false);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Assign driver and vehicle">
      <div className="w-full max-w-md rounded-bmpl-xl border border-slate-200 bg-white p-5 shadow-bmpl-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-belize-navy">Assign {trip.reference}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {trip.providerName && (
          <p className="mb-3 text-sm text-slate-600">
            Operated by <span className="font-medium text-slate-800">{trip.providerName}</span> — only that operator&apos;s
            own fleet drivers can staff it; anyone else is refused when you submit.
          </p>
        )}

        {loadErr ? (
          <p className="rounded-bmpl-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadErr}</p>
        ) : drivers === null ? (
          <Loading />
        ) : drivers.length === 0 ? (
          <p className="text-sm text-slate-500">No passenger drivers are registered yet.</p>
        ) : (
          <div className="space-y-4">
            <Field label="Driver">
              <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">Select a driver…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName || d.name}
                    {d.roleStatus ? ` · ${d.roleStatus.toLowerCase()}` : ''}
                    {d.homeDistrict ? ` · ${d.homeDistrict.replace(/_/g, ' ')}` : ''}
                  </option>
                ))}
              </Select>
            </Field>

            {driverId && (
              <Field label="Vehicle" hint="Approved, active vehicles only.">
                {vehicles === null ? (
                  <Loading />
                ) : vehicles.length === 0 ? (
                  <p className="text-sm text-slate-500">This driver has no approved active vehicle.</p>
                ) : (
                  <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">Select a vehicle…</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.make} {v.model} · {v.licencePlate}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}

            {err && <p className="text-sm font-medium text-red-600">{err}</p>}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy}>
                {busy ? 'Assigning…' : 'Assign'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ bookings */

const BOOKING_STATUSES = ['REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'];

const BOOKING_TONE: Record<BookingRow['status'], 'info' | 'success' | 'neutral' | 'warning'> = {
  REQUESTED: 'info',
  CONFIRMED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'warning',
  EXPIRED: 'neutral',
};

function BookingsTab() {
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [canModerate, setCanModerate] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<BookingRow[]>(`/admin/passengers/bookings${status ? `?status=${status}` : ''}`));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load bookings.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(b: BookingRow, action: 'confirm' | 'cancel') {
    let body: { reason?: string } | undefined;
    if (action === 'cancel') {
      const reason = window.prompt('Why is this booking being cancelled? The rider sees this.')?.trim();
      if (!reason) return;
      body = { reason };
    }
    setBusy(b.id);
    setNote(null);
    try {
      await api.post(`/admin/passengers/bookings/${b.id}/${action}`, body ?? {});
      setNote(`${b.reference} ${action === 'confirm' ? 'confirmed' : 'cancelled'}.`);
      await load();
    } catch (e) {
      const ex = e as ApiError;
      if (ex.status === 403) setCanModerate(false);
      else setErr(ex.message ?? 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-4 max-w-xs">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>
            ))}
          </Select>
        </Field>
      </div>
      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}
      {note && <Alert tone="success" className="mb-4">{note}</Alert>}
      {loading ? (
        <Loading />
      ) : rows.length === 0 && !err ? (
        <EmptyState
          title="No bookings"
          description="No seat bookings match. Riders book onto published departures; requests appear here for oversight."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((b) => (
            <div key={b.id} className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-belize-navy">{b.reference}</span>
                    <Badge tone={BOOKING_TONE[b.status]}>{b.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                    <Badge tone="neutral">{b.seats} seat{b.seats === 1 ? '' : 's'}</Badge>
                    {b.isTest && <Badge tone="neutral">Simulation</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {b.passengerName ?? '—'}
                    {b.routeName ? ` · ${b.routeName}` : ''}
                    {b.from && b.to ? ` · ${b.from} → ${b.to}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {b.tripReference ? `Departure ${b.tripReference}` : 'No departure attached'}
                    {b.tripStatus ? ` (${b.tripStatus.replace(/_/g, ' ').toLowerCase()})` : ''}
                    {b.scheduledDepartureAt ? ` · departs ${when(b.scheduledDepartureAt)}` : ''}
                  </p>
                  {b.cancellationReason && (
                    <p className="mt-1 text-xs font-medium text-amber-800">
                      Cancelled{b.cancelledBy ? ` by ${b.cancelledBy.toLowerCase()}` : ''}: {b.cancellationReason}
                    </p>
                  )}
                </div>
                {canModerate && (b.status === 'REQUESTED' || b.status === 'CONFIRMED') && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {b.status === 'REQUESTED' && (
                      <Button size="sm" variant="primary" disabled={busy === b.id} onClick={() => void act(b, 'confirm')}>
                        Confirm
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={busy === b.id} onClick={() => void act(b, 'cancel')}>
                      Cancel booking
                    </Button>
                  </div>
                )}
              </div>
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

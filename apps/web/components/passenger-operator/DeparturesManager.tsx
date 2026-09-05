'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, EmptyState, Field, Input, Select, Spinner, StatusBadge } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { isFareConfigured, tripCancellable, type OperatorRoute, type OperatorTrip } from '../../lib/passenger-operator';
import { affiliationView, type ProviderAffiliationRow } from '../../lib/passenger-fleet';
import type { PassengerVehicle } from '../../lib/passenger-driver';
import { ApprovalRequired } from './data';

/**
 * The operator's departures: publish one, see where each stands, staff a
 * scheduled one, cancel one that has not begun. Staffing (BMPL-39) offers the
 * fleet's ACCEPTED drivers and its usable vehicles; every rule beyond that —
 * own-fleet-only, driver approval, the test boundary, the rider-cannot-drive
 * check — is the server's, and its refusals are shown verbatim. With nobody
 * in the roster the control does not render at all: the row says why instead,
 * because a picker with nobody eligible is a control that cannot succeed.
 */
export function DeparturesManager() {
  const [trips, setTrips] = useState<OperatorTrip[] | null>(null);
  const [routes, setRoutes] = useState<OperatorRoute[] | null>(null);
  const [fleetDrivers, setFleetDrivers] = useState<ProviderAffiliationRow[]>([]);
  const [vehicles, setVehicles] = useState<PassengerVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [notApproved, setNotApproved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [t, r, a, v] = await Promise.all([
        api.get<OperatorTrip[]>('/passenger/provider/trips'),
        api.get<OperatorRoute[]>('/passenger/provider/routes'),
        api.get<ProviderAffiliationRow[]>('/passenger/provider/affiliations?status=ACCEPTED'),
        api.get<PassengerVehicle[]>('/passenger/provider/vehicles'),
      ]);
      setTrips(t);
      setRoutes(r);
      setFleetDrivers(a.filter((row) => affiliationView(row, 'PROVIDER').kind === 'active'));
      // The same row fields the server checks for assignability — a read of
      // its rule, not a second statement of it.
      setVehicles(v.filter((veh) => veh.approvalStatus === 'APPROVED' && veh.isActive));
      setNotApproved(false);
      setErr(null);
    } catch (e) {
      if ((e as ApiError).status === 403) setNotApproved(true);
      else setErr(errMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (notApproved) return <ApprovalRequired />;

  const activeRoutes = (routes ?? []).filter((r) => r.isActive);

  return (
    <div className="space-y-4">
      {err && <Alert tone="error">{err}</Alert>}

      {trips && trips.length === 0 && !addingOpen && (
        <EmptyState title="No departures yet" description="Publish a departure of one of your routes to take bookings for it." />
      )}

      {trips?.map((t) => <TripCard key={t.id} trip={t} fleetDrivers={fleetDrivers} vehicles={vehicles} onChanged={reload} />)}

      {addingOpen ? (
        <TripForm
          routes={activeRoutes}
          onCancel={() => setAddingOpen(false)}
          onSaved={async () => {
            setAddingOpen(false);
            await reload();
          }}
        />
      ) : (
        <Button type="button" variant="outline" onClick={() => setAddingOpen(true)} disabled={activeRoutes.length === 0}>
          + Publish departure
        </Button>
      )}
      {activeRoutes.length === 0 && !addingOpen && (
        <p className="text-xs text-slate-500">A departure belongs to a route — declare an active route first.</p>
      )}
    </div>
  );
}

function TripCard({
  trip: t,
  fleetDrivers,
  vehicles,
  onChanged,
}: {
  trip: OperatorTrip;
  fleetDrivers: ProviderAffiliationRow[];
  vehicles: PassengerVehicle[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/passenger/provider/trips/${t.id}/cancel`, { reason: reason.trim() || undefined });
      setCancelOpen(false);
      await onChanged();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiCard className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm text-belize-navy">{t.routeName ?? 'Departure'}</b>
            <StatusBadge status={t.status} />
            <Badge tone="neutral">{t.reference}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {t.scheduledDepartureAt ? `Departs ${new Date(t.scheduledDepartureAt).toLocaleString()}` : 'No departure time'}
          </p>
          {t.driverName ? (
            <p className="mt-1 text-sm text-slate-600">
              Driver: {t.driverName}
              {t.vehicle && (
                <>
                  {' '}
                  · {t.vehicle.make} {t.vehicle.model} ({t.vehicle.licencePlate})
                </>
              )}
              {t.seatCapacity != null && (
                <>
                  {' '}
                  · {t.seatsConfirmed ?? 0}/{t.seatCapacity} seats sold
                </>
              )}
            </p>
          ) : (
            t.status === 'SCHEDULED' &&
            // The reasons a staffing control cannot succeed, said in its
            // place. Only fleet drivers may staff a departure (the server's
            // rule); vehicles here are the fleet's usable ones.
            (fleetDrivers.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                Unstaffed. Only your own fleet drivers can staff a departure — build your roster from the Operator
                Dashboard first.
              </p>
            ) : vehicles.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                Unstaffed. Staffing needs an approved, active fleet vehicle — add one under Fleet Vehicles.
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Unstaffed.</p>
            ))
          )}
          {t.cancellationReason && <p className="mt-1 text-xs text-slate-500">Cancelled: {t.cancellationReason}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t.status === 'SCHEDULED' && fleetDrivers.length > 0 && vehicles.length > 0 && !assignOpen && (
            <Button type="button" size="sm" onClick={() => setAssignOpen(true)}>
              Assign driver
            </Button>
          )}
          {tripCancellable(t.status) && !cancelOpen && (
            <Button type="button" size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
              Cancel departure
            </Button>
          )}
        </div>
      </div>

      {assignOpen && (
        <AssignForm
          tripId={t.id}
          fleetDrivers={fleetDrivers}
          vehicles={vehicles}
          onClose={() => setAssignOpen(false)}
          onDone={async () => {
            setAssignOpen(false);
            await onChanged();
          }}
        />
      )}

      {cancelOpen && (
        <div className="mt-3 space-y-2 rounded-bmpl-md border border-slate-200 p-3">
          <Field label="Reason" htmlFor={`${t.id}-reason`} hint="Optional — riders with bookings see this.">
            <Input id={`${t.id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={cancel}>
              Cancel this departure
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
      {err && (
        <Alert tone="error" className="mt-3">
          {err}
        </Alert>
      )}
    </UiCard>
  );
}

/**
 * Staff a departure: one of the fleet's ACCEPTED drivers plus one of its
 * usable vehicles, against the assign endpoint. Capacity is snapshotted from
 * the vehicle at assignment — confirmations sell its seats — so the vehicle
 * option says its seat count. The server re-checks everything (own-fleet,
 * driver approval, test boundary, the rider-cannot-drive rule) and its
 * refusals are shown verbatim.
 */
function AssignForm({
  tripId,
  fleetDrivers,
  vehicles,
  onClose,
  onDone,
}: {
  tripId: string;
  fleetDrivers: ProviderAffiliationRow[];
  vehicles: PassengerVehicle[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [driverProfileId, setDriverProfileId] = useState(fleetDrivers[0]?.driver.id ?? '');
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/passenger/provider/trips/${tripId}/assign`, { driverProfileId, vehicleId });
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-3 space-y-3 rounded-bmpl-md border border-slate-200 p-3" onSubmit={submit}>
      {err && <Alert tone="error">{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Driver" htmlFor={`${tripId}-assignDriver`} hint="Your fleet's drivers.">
          <Select id={`${tripId}-assignDriver`} value={driverProfileId} onChange={(e) => setDriverProfileId(e.target.value)}>
            {fleetDrivers.map((r) => (
              <option key={r.driver.id} value={r.driver.id}>
                {r.driver.displayName}
                {r.driver.availability ? ` (${r.driver.availability.toLowerCase()})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vehicle" htmlFor={`${tripId}-assignVehicle`} hint="Its seat count becomes this departure's capacity.">
          <Select id={`${tripId}-assignVehicle`} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.make} {v.model} ({v.licencePlate}) — {v.seatCapacity} seat{v.seatCapacity === 1 ? '' : 's'}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !driverProfileId || !vehicleId}>
          Assign
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TripForm({
  routes,
  onCancel,
  onSaved,
}: {
  routes: OperatorRoute[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [routeId, setRouteId] = useState(routes[0]?.id ?? '');
  const [departureAt, setDepartureAt] = useState('');
  const [arrivalAt, setArrivalAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const route = routes.find((r) => r.id === routeId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/passenger/provider/trips', {
        routeId,
        scheduledDepartureAt: departureAt,
        scheduledArrivalAt: arrivalAt || undefined,
      });
      await onSaved();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiCard className="p-4 sm:p-6">
      <h2 className="bmpl-eyebrow mb-4">Publish departure</h2>
      {err && (
        <Alert tone="error" className="mb-4">
          {err}
        </Alert>
      )}
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Route" htmlFor="tripRoute">
          <Select id="tripRoute" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.originCity} → {r.destinationCity})
              </option>
            ))}
          </Select>
        </Field>
        {route && !isFareConfigured(route.baseFareMinor) && (
          <Alert tone="warning">
            This route has no fare configured, so this departure can be published but not booked until one is set.
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Departure time" htmlFor="tripDep">
            <Input id="tripDep" type="datetime-local" value={departureAt} onChange={(e) => setDepartureAt(e.target.value)} required />
          </Field>
          <Field label="Arrival time" htmlFor="tripArr" hint="Optional">
            <Input id="tripArr" type="datetime-local" value={arrivalAt} onChange={(e) => setArrivalAt(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !routeId || !departureAt}>Publish</Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </UiCard>
  );
}

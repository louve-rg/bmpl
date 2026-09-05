'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { DISTRICTS, DISTRICT_LABELS, type District } from '@bmpl/shared';
import { api, type ApiError } from '../../lib/api';
import { Alert, Badge, Button, Card as UiCard, EmptyState, Field, Input, Select, Spinner, Textarea } from '../ui';
import { errMessage } from '../driver/dashboard-data';
import { formatBzd, isFareConfigured, type OperatorRoute } from '../../lib/passenger-operator';
import { ApprovalRequired } from './data';

/**
 * The operator's own routes — an operator-entered fact about Belize: which
 * towns their service connects, in what order. Nothing here derives or
 * defaults geography, and the fare is stored VERBATIM with no per-seat or
 * per-booking unit — that policy is undecided, and a label must not decide
 * it. An unpriced route (no fare, or zero) says plainly that its departures
 * cannot be booked: that is the server's fare gate, surfaced here instead of
 * discovered through rider complaints.
 */
export function RoutesManager() {
  const [routes, setRoutes] = useState<OperatorRoute[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notApproved, setNotApproved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRoutes(await api.get<OperatorRoute[]>('/passenger/provider/routes'));
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

  return (
    <div className="space-y-4">
      {err && <Alert tone="error">{err}</Alert>}

      {routes && routes.length === 0 && !addingOpen && (
        <EmptyState
          title="No routes yet"
          description="Declare the journeys your service runs — origin, destination and any stops along the way."
        />
      )}

      {routes?.map((r) =>
        editingId === r.id ? (
          <RouteEditor
            key={r.id}
            route={r}
            onClose={() => setEditingId(null)}
            onSaved={async () => {
              setEditingId(null);
              await reload();
            }}
          />
        ) : (
          <RouteCard key={r.id} route={r} onEdit={() => setEditingId(r.id)} onChanged={reload} onError={setErr} />
        ),
      )}

      {addingOpen ? (
        <RouteForm
          onCancel={() => setAddingOpen(false)}
          onSaved={async () => {
            setAddingOpen(false);
            await reload();
          }}
        />
      ) : (
        <Button type="button" variant="outline" onClick={() => setAddingOpen(true)}>
          + Add route
        </Button>
      )}
    </div>
  );
}

function districtText(d: string): string {
  return DISTRICT_LABELS[d as District] ?? d.replace(/_/g, ' ');
}

function RouteCard({
  route: r,
  onEdit,
  onChanged,
  onError,
}: {
  route: OperatorRoute;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    try {
      await api.patch(`/passenger/provider/routes/${r.id}`, { isActive: !r.isActive });
      await onChanged();
    } catch (e) {
      onError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiCard className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm text-belize-navy">{r.name}</b>
            <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
            {r.isTest && <Badge tone="neutral">Simulation</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {r.originCity}, {districtText(r.originDistrict)} → {r.destinationCity}, {districtText(r.destinationDistrict)}
            {r.durationMinutes != null ? ` · ~${r.durationMinutes} min` : ''}
            {r.tripCount != null ? ` · ${r.tripCount} departure${r.tripCount === 1 ? '' : 's'}` : ''}
          </p>
          {/* The fail-closed fare rule, surfaced. The fare carries no per-seat
              or per-booking unit — that policy is undecided, and the label
              must not decide it. */}
          {isFareConfigured(r.baseFareMinor) ? (
            <p className="mt-0.5 text-xs text-slate-600">Fare {formatBzd(r.baseFareMinor as number)}</p>
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
                  {s.sequence}. {s.name ? `${s.name}, ` : ''}
                  {s.city}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            Edit
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={toggleActive}>
            {r.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>
    </UiCard>
  );
}

/* ------------------------------------------------------------ route form */

interface StopDraft {
  district: District;
  city: string;
  name: string;
}

function StopsFields({ stops, onChange }: { stops: StopDraft[]; onChange: (s: StopDraft[]) => void }) {
  return (
    <div className="space-y-2">
      {stops.map((s, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <span className="pb-2 text-xs text-slate-400">{i + 1}.</span>
          <Select
            aria-label={`Stop ${i + 1} district`}
            className="w-36"
            value={s.district}
            onChange={(e) => onChange(stops.map((x, j) => (j === i ? { ...x, district: e.target.value as District } : x)))}
          >
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {DISTRICT_LABELS[d]}
              </option>
            ))}
          </Select>
          <Input
            aria-label={`Stop ${i + 1} town`}
            className="w-40"
            placeholder="Town"
            value={s.city}
            onChange={(e) => onChange(stops.map((x, j) => (j === i ? { ...x, city: e.target.value } : x)))}
            required
          />
          <Input
            aria-label={`Stop ${i + 1} name`}
            className="w-40"
            placeholder="Stop name (optional)"
            value={s.name}
            onChange={(e) => onChange(stops.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={i === 0}
            onClick={() => {
              const next = [...stops];
              const above = next[i - 1];
              const here = next[i];
              if (above === undefined || here === undefined) return;
              next[i - 1] = here;
              next[i] = above;
              onChange(next);
            }}
          >
            ↑
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onChange(stops.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...stops, { district: DISTRICTS[0], city: '', name: '' }])}>
        + Add stop
      </Button>
    </div>
  );
}

function stopsBody(stops: StopDraft[]) {
  // Order comes from array position — the client never numbers stops itself.
  return stops.map((s) => ({ district: s.district, city: s.city, name: s.name || undefined }));
}

/** Shared fields for create and edit; `fareBzd` is dollars in the input, sent as minor units verbatim. */
function coreFields(f: {
  name: string;
  description: string;
  originDistrict: District;
  originCity: string;
  destinationDistrict: District;
  destinationCity: string;
  scheduleNote: string;
  durationMinutes: string;
  fareBzd: string;
}) {
  return {
    name: f.name,
    description: f.description || undefined,
    originDistrict: f.originDistrict,
    originCity: f.originCity,
    destinationDistrict: f.destinationDistrict,
    destinationCity: f.destinationCity,
    scheduleNote: f.scheduleNote || undefined,
    durationMinutes: f.durationMinutes.trim() === '' ? undefined : Number(f.durationMinutes),
    baseFareMinor: f.fareBzd.trim() === '' ? undefined : Math.round(Number(f.fareBzd) * 100),
  };
}

function RouteFields({
  f,
  setF,
  idBase,
}: {
  f: Parameters<typeof coreFields>[0];
  setF: (v: Parameters<typeof coreFields>[0]) => void;
  idBase: string;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Service name" htmlFor={`${idBase}-name`} hint='e.g. the name riders know it by'>
          <Input id={`${idBase}-name`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label="Schedule note" htmlFor={`${idBase}-schedule`} hint="Optional — shown verbatim, e.g. “Mon–Sat 06:30”. Not a timetable.">
          <Input id={`${idBase}-schedule`} value={f.scheduleNote} onChange={(e) => setF({ ...f, scheduleNote: e.target.value })} />
        </Field>
        <Field label="Origin district" htmlFor={`${idBase}-od`}>
          <Select id={`${idBase}-od`} value={f.originDistrict} onChange={(e) => setF({ ...f, originDistrict: e.target.value as District })}>
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {DISTRICT_LABELS[d]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Origin town" htmlFor={`${idBase}-oc`}>
          <Input id={`${idBase}-oc`} value={f.originCity} onChange={(e) => setF({ ...f, originCity: e.target.value })} required />
        </Field>
        <Field label="Destination district" htmlFor={`${idBase}-dd`}>
          <Select
            id={`${idBase}-dd`}
            value={f.destinationDistrict}
            onChange={(e) => setF({ ...f, destinationDistrict: e.target.value as District })}
          >
            {DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {DISTRICT_LABELS[d]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Destination town" htmlFor={`${idBase}-dc`}>
          <Input id={`${idBase}-dc`} value={f.destinationCity} onChange={(e) => setF({ ...f, destinationCity: e.target.value })} required />
        </Field>
        <Field label="Journey time (minutes)" htmlFor={`${idBase}-dur`} hint="Optional">
          <Input
            id={`${idBase}-dur`}
            type="number"
            min={1}
            value={f.durationMinutes}
            onChange={(e) => setF({ ...f, durationMinutes: e.target.value })}
          />
        </Field>
        <Field
          label="Fare (BZ$)"
          htmlFor={`${idBase}-fare`}
          hint="Departures cannot be booked until a fare is set."
        >
          <Input
            id={`${idBase}-fare`}
            type="number"
            min={0}
            step="0.01"
            value={f.fareBzd}
            onChange={(e) => setF({ ...f, fareBzd: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Description" htmlFor={`${idBase}-desc`} hint="Optional — shown to riders.">
        <Textarea id={`${idBase}-desc`} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
    </>
  );
}

const emptyRouteDraft = () => ({
  name: '',
  description: '',
  originDistrict: DISTRICTS[0] as District,
  originCity: '',
  destinationDistrict: DISTRICTS[0] as District,
  destinationCity: '',
  scheduleNote: '',
  durationMinutes: '',
  fareBzd: '',
});

function RouteForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState(emptyRouteDraft());
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/passenger/provider/routes', {
        ...coreFields(f),
        ...(stops.length > 0 ? { stops: stopsBody(stops) } : {}),
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
      <h2 className="bmpl-eyebrow mb-4">New route</h2>
      {err && (
        <Alert tone="error" className="mb-4">
          {err}
        </Alert>
      )}
      <form className="space-y-4" onSubmit={submit}>
        <RouteFields f={f} setF={setF} idBase="newRoute" />
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Stops along the way (optional, in order)</p>
          <StopsFields stops={stops} onChange={setStops} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !f.name || !f.originCity || !f.destinationCity}>Create route</Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </UiCard>
  );
}

/**
 * Editing splits exactly where the API splits: core fields PATCH the route,
 * stops are REPLACED whole via PUT …/stops (order is array position).
 */
function RouteEditor({ route, onClose, onSaved }: { route: OperatorRoute; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({
    name: route.name,
    description: route.description ?? '',
    originDistrict: route.originDistrict as District,
    originCity: route.originCity,
    destinationDistrict: route.destinationDistrict as District,
    destinationCity: route.destinationCity,
    scheduleNote: route.scheduleNote ?? '',
    durationMinutes: route.durationMinutes != null ? String(route.durationMinutes) : '',
    fareBzd: route.baseFareMinor != null ? (route.baseFareMinor / 100).toFixed(2) : '',
  });
  const [stops, setStops] = useState<StopDraft[]>(
    (route.stops ?? []).map((s) => ({ district: s.district as District, city: s.city, name: s.name ?? '' })),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/passenger/provider/routes/${route.id}`, coreFields(f));
      await api.put(`/passenger/provider/routes/${route.id}/stops`, stopsBody(stops));
      await onSaved();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiCard className="p-4 sm:p-6">
      <h2 className="bmpl-eyebrow mb-4">Edit route</h2>
      {err && (
        <Alert tone="error" className="mb-4">
          {err}
        </Alert>
      )}
      <form className="space-y-4" onSubmit={submit}>
        <RouteFields f={f} setF={setF} idBase={route.id} />
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Stops along the way (in order)</p>
          <StopsFields stops={stops} onChange={setStops} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !f.name || !f.originCity || !f.destinationCity}>Save route</Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </UiCard>
  );
}

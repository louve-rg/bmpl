'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner } from '../../../../components/ui';
import { RouteScheduleEditor } from './schedule-editor';

/**
 * The transport services between terminals.
 *
 * Deactivating a route here is how a grounded flight stops being quoted to
 * customers — within the next request, because the planner reads these rows
 * fresh every time rather than caching them.
 */

interface HubRef {
  id: string;
  code: string;
  name: string;
  modes: string[];
}

interface Route {
  id: string;
  originHub: HubRef;
  destinationHub: HubRef;
  mode: string;
  carrierName: string | null;
  carrierPhone: string | null;
  scheduleNote: string | null;
  durationMinutes: number;
  priceMinor: number;
  isActive: boolean;
}

const blank = {
  originHubId: '', destinationHubId: '', mode: 'AIR',
  carrierName: '', carrierPhone: '', scheduleNote: '',
  durationMinutes: '60', price: '',
};

/** "1h 45m" reads better to an operator than "105". */
function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function RoutesPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [hubs, setHubs] = useState<HubRef[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, h] = await Promise.all([
        api.get<Route[]>('/admin/logistics/routes'),
        api.get<Array<HubRef & { isActive: boolean }>>('/admin/logistics/hubs'),
      ]);
      setRoutes(r);
      setHubs(h.filter((x) => x.isActive));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load routes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only offer terminals that can physically handle the chosen mode. The API
  // enforces this too — this just stops the operator discovering it via an error.
  const usable = hubs.filter((h) => h.modes.includes(form.mode));

  async function create() {
    setSaving(true);
    setErr(null);
    try {
      await api.post('/admin/logistics/routes', {
        originHubId: form.originHubId,
        destinationHubId: form.destinationHubId,
        mode: form.mode,
        carrierName: form.carrierName || undefined,
        carrierPhone: form.carrierPhone || undefined,
        scheduleNote: form.scheduleNote || undefined,
        durationMinutes: Number(form.durationMinutes),
        priceMinor: Math.round(Number(form.price) * 100),
      });
      setForm({ ...blank });
      await load();
    } catch (e) {
      const a = e as ApiError;
      setErr(a.errors?.[0]?.message ?? a.message ?? 'Could not add that route.');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(route: Route) {
    try {
      await api.patch(`/admin/logistics/routes/${route.id}`, { isActive: !route.isActive });
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not update that route.');
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], 'Routes')}
        title="Routes"
        description="Who runs what, between which terminals, at what price. Deactivate one and it stops being quoted immediately."
      />

      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Add a route</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Mode" htmlFor="route-mode">
            <Select id="route-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value, originHubId: '', destinationHubId: '' })}>
              <option value="LAND">Road</option>
              <option value="AIR">Flight</option>
              <option value="SEA">Boat</option>
            </Select>
          </Field>
          <Field label="From" htmlFor="route-from">
            <Select id="route-from" value={form.originHubId} onChange={(e) => setForm({ ...form, originHubId: e.target.value })}>
              <option value="">Choose…</option>
              {usable.map((h) => (
                <option key={h.id} value={h.id}>{h.code} · {h.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="To" htmlFor="route-to">
            <Select id="route-to" value={form.destinationHubId} onChange={(e) => setForm({ ...form, destinationHubId: e.target.value })}>
              <option value="">Choose…</option>
              {usable.filter((h) => h.id !== form.originHubId).map((h) => (
                <option key={h.id} value={h.id}>{h.code} · {h.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Carrier" htmlFor="route-carrier" hint="Who actually operates it.">
            <Input id="route-carrier" value={form.carrierName} onChange={(e) => setForm({ ...form, carrierName: e.target.value })} placeholder="Tropic Air" />
          </Field>
          <Field label="Carrier phone" htmlFor="route-carrier-phone">
            <Input id="route-carrier-phone" value={form.carrierPhone} onChange={(e) => setForm({ ...form, carrierPhone: e.target.value })} />
          </Field>
          <Field label="Duration (minutes)" htmlFor="route-duration">
            <Input id="route-duration" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label="Price (BZ$)" htmlFor="route-price">
            <Input id="route-price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" placeholder="80.00" />
          </Field>
          <Field label="Schedule note" htmlFor="route-schedule" hint="Free text. The planner reports it; it does not parse it.">
            <Input id="route-schedule" value={form.scheduleNote} onChange={(e) => setForm({ ...form, scheduleNote: e.target.value })} placeholder="Mon/Wed/Fri 09:00" />
          </Field>
        </div>
        <Button
          onClick={create}
          disabled={saving || !form.originHubId || !form.destinationHubId || !form.price}
          className="mt-3"
        >
          {saving ? 'Adding…' : 'Add route'}
        </Button>
      </Card>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {routes.map((r) => (
            <Card key={r.id} className={`p-4 ${r.isActive ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-sm font-semibold text-slate-900">
                      {r.originHub.name} → {r.destinationHub.name}
                    </span>
                    <Badge tone="info">{r.mode}</Badge>
                    <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Running' : 'Suspended'}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {r.carrierName ?? 'Carrier not named'} · {duration(r.durationMinutes)} · ${(r.priceMinor / 100).toFixed(2)}
                    {r.scheduleNote ? ` · ${r.scheduleNote}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" onClick={() => setScheduleFor(scheduleFor === r.id ? null : r.id)}>
                    {scheduleFor === r.id ? 'Hide schedule' : 'Schedule'}
                  </Button>
                  <Button variant="outline" onClick={() => void toggle(r)}>
                    {r.isActive ? 'Suspend' : 'Resume'}
                  </Button>
                </div>
              </div>
              {scheduleFor === r.id && <RouteScheduleEditor routeId={r.id} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

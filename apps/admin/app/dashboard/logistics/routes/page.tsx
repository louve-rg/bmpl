'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { Alert, Badge, Button, Card, Field, Input, LoadingRow, PageHeader, Select } from '../../../../components/ui';
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
  isTest?: boolean;
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
  isTest?: boolean;
}

const blank = {
  originHubId: '', destinationHubId: '', mode: 'AIR',
  carrierName: '', carrierPhone: '', scheduleNote: '',
  durationMinutes: '60', price: '', isTest: false,
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
  const [canManage, setCanManage] = useState(false);
  // TERM-ROUTE-BLANK-CARRIER-STRANDS-A-READY-LEG part 3: the one place a
  // route already saved with no carrier (or the wrong one) can be fixed.
  // `updateRouteSchema` has accepted a partial carrierName since it was
  // written; no screen ever called it for this field until now.
  const [editCarrierFor, setEditCarrierFor] = useState<string | null>(null);
  const [carrierEdit, setCarrierEdit] = useState<Record<string, string>>({});
  const [savingCarrier, setSavingCarrier] = useState(false);

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

  // The edit affordance is drawn only for logistics.manage — /me returns the
  // same grant rows the PermissionsGuard evaluates (BMPL-47), so what this
  // screen shows and what the API enforces cannot disagree. On any doubt
  // (request fails, field absent) it stays hidden: fail closed. Same pattern
  // as hubs/page.tsx (BMPL-142), applied here (BMPL-267) after this page
  // shipped without it.
  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => setCanManage((me.adminPermissions ?? []).includes('logistics.manage')))
      .catch(() => setCanManage(false));
  }, []);

  // Only offer terminals that can physically handle the chosen mode. The API
  // enforces this too — this just stops the operator discovering it via an error.
  const usable = hubs.filter((h) => h.modes.includes(form.mode));
  // ADMIN-ROUTE-FORM-HIDES-ITS-HUBS-AND-NEVER-SAYS-WHY part 1: with no hub
  // for the selected mode, From/To fall back to an empty "Choose…" list that
  // reads exactly like "no hubs exist" — indistinguishable from production's
  // actual empty hub network. An operator hand-building a route (no other
  // mode's hubs to compare against) has no way to tell those two apart
  // without this naming the cause. The hub-to-mode filtering itself is
  // unchanged; this only explains what it already does.
  const noHubsForMode = usable.length === 0;

  const missingFields: string[] = [];
  if (!form.originHubId) missingFields.push('From');
  if (!form.destinationHubId) missingFields.push('To');
  if (!form.carrierName.trim()) missingFields.push('Carrier');
  if (!form.price) missingFields.push('Price');

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
        isTest: form.isTest,
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

  async function saveCarrier(route: Route) {
    const value = (carrierEdit[route.id] ?? route.carrierName ?? '').trim();
    if (!value) {
      setErr('Name the carrier operating this route.');
      return;
    }
    setSavingCarrier(true);
    setErr(null);
    try {
      await api.patch(`/admin/logistics/routes/${route.id}`, { carrierName: value });
      setEditCarrierFor(null);
      await load();
    } catch (e) {
      const a = e as ApiError;
      setErr(a.errors?.[0]?.message ?? a.message ?? 'Could not update the carrier.');
    } finally {
      setSavingCarrier(false);
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

      {/* Every control in this card and the Suspend/Resume button below write
          through logistics.manage-guarded routes, so for logistics.read the
          whole screen reads as a report: no create form, no suspend control
          — hidden like hubs/page.tsx's Edit button, not disabled (BMPL-142).
          The server stays the authority; this only stops drawing buttons
          that could never work. */}
      {canManage && (
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Add a route</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Mode" htmlFor="route-mode">
            <Select id="route-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value, originHubId: '', destinationHubId: '' })}>
              <option value="LAND">Road</option>
              <option value="AIR">Flight</option>
              <option value="SEA">Boat</option>
            </Select>
          </Field>
          <Field
            label="From *"
            htmlFor="route-from"
            hint={noHubsForMode ? 'No hubs serve this mode yet — switch Mode, or add a hub for it.' : undefined}
          >
            <Select id="route-from" value={form.originHubId} onChange={(e) => setForm({ ...form, originHubId: e.target.value })}>
              <option value="">Choose…</option>
              {usable.map((h) => (
                <option key={h.id} value={h.id}>{h.code} · {h.name}{h.isTest ? ' · Simulation' : ''}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="To *"
            htmlFor="route-to"
            hint={noHubsForMode ? 'No hubs serve this mode yet — switch Mode, or add a hub for it.' : undefined}
          >
            <Select id="route-to" value={form.destinationHubId} onChange={(e) => setForm({ ...form, destinationHubId: e.target.value })}>
              <option value="">Choose…</option>
              {usable.filter((h) => h.id !== form.originHubId).map((h) => (
                <option key={h.id} value={h.id}>{h.code} · {h.name}{h.isTest ? ' · Simulation' : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="Carrier *" htmlFor="route-carrier" hint="Required — the carrier named here is who moves parcels along this route.">
            <Input id="route-carrier" required value={form.carrierName} onChange={(e) => setForm({ ...form, carrierName: e.target.value })} placeholder="Enter the carrier's name" />
          </Field>
          <Field label="Carrier phone" htmlFor="route-carrier-phone">
            <Input id="route-carrier-phone" value={form.carrierPhone} onChange={(e) => setForm({ ...form, carrierPhone: e.target.value })} />
          </Field>
          <Field label="Duration (minutes)" htmlFor="route-duration">
            <Input id="route-duration" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label="Price (BZ$) *" htmlFor="route-price">
            <Input id="route-price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" placeholder="80.00" />
          </Field>
          <Field label="Schedule note" htmlFor="route-schedule" hint="Free text. The planner reports it; it does not parse it.">
            <Input id="route-schedule" value={form.scheduleNote} onChange={(e) => setForm({ ...form, scheduleNote: e.target.value })} placeholder="Mon/Wed/Fri 09:00" />
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-[color:var(--bmpl-text-muted)]">
          <input type="checkbox" checked={form.isTest} onChange={(e) => setForm({ ...form, isTest: e.target.checked })} className="accent-belize-blue" />
          Simulation route (isTest) — never mixed with real hubs or real staff
        </label>
        <Button
          onClick={create}
          disabled={saving || missingFields.length > 0}
          className="mt-3"
        >
          {saving ? 'Adding…' : 'Add route'}
        </Button>
        {!saving && missingFields.length > 0 && (
          <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted-strong)]">Still needed: {missingFields.join(', ')}.</p>
        )}
      </Card>
      )}

      {loading ? (
        <LoadingRow className="mt-6" />
      ) : (
        <div className="mt-6 space-y-3">
          {routes.map((r) => (
            <Card key={r.id} className={`p-4 ${r.isActive ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-sm font-semibold text-[color:var(--bmpl-text)]">
                      {r.originHub.name} → {r.destinationHub.name}
                    </span>
                    <Badge tone="info">{r.mode}</Badge>
                    <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Running' : 'Suspended'}</Badge>
                    {r.isTest && <Badge tone="neutral">Simulation</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                    {r.carrierName ?? 'Carrier not named'} · {duration(r.durationMinutes)} · ${(r.priceMinor / 100).toFixed(2)}
                    {r.scheduleNote ? ` · ${r.scheduleNote}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {/* Visible to a reader too — GET .../schedule needs only
                      logistics.read, the same permission this whole page
                      already requires to load at all. */}
                  <Button variant="outline" onClick={() => setScheduleFor(scheduleFor === r.id ? null : r.id)}>
                    {scheduleFor === r.id ? 'Hide schedule' : 'Schedule'}
                  </Button>
                  {canManage && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setCarrierEdit({ ...carrierEdit, [r.id]: carrierEdit[r.id] ?? r.carrierName ?? '' });
                        setEditCarrierFor(editCarrierFor === r.id ? null : r.id);
                      }}
                    >
                      {editCarrierFor === r.id ? 'Cancel' : 'Edit carrier'}
                    </Button>
                  )}
                  {canManage && (
                    <Button variant="outline" onClick={() => void toggle(r)}>
                      {r.isActive ? 'Suspend' : 'Resume'}
                    </Button>
                  )}
                </div>
              </div>
              {editCarrierFor === r.id && (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[color:var(--bmpl-border-soft)] pt-3">
                  <Field label="Carrier" htmlFor={`route-carrier-edit-${r.id}`} hint="Required — the carrier named here is who moves parcels along this route.">
                    <Input
                      id={`route-carrier-edit-${r.id}`}
                      required
                      value={carrierEdit[r.id] ?? ''}
                      onChange={(e) => setCarrierEdit({ ...carrierEdit, [r.id]: e.target.value })}
                    />
                  </Field>
                  <Button disabled={savingCarrier || !(carrierEdit[r.id] ?? '').trim()} onClick={() => void saveCarrier(r)}>
                    {savingCarrier ? 'Saving…' : 'Save carrier'}
                  </Button>
                </div>
              )}
              {scheduleFor === r.id && <RouteScheduleEditor routeId={r.id} canManage={canManage} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

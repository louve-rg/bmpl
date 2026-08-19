'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner } from '../../../../components/ui';

/**
 * Terminals, as data.
 *
 * This screen is the reason the route planner contains no place names. Opening
 * Corozal, closing an airstrip for the season, or correcting a courier rate
 * happens here — never in a deploy.
 */

const HUB_TYPES = [
  'AIRPORT', 'AIRSTRIP', 'WATER_TAXI_TERMINAL', 'SEA_TERMINAL',
  'BUS_TERMINAL', 'WAREHOUSE', 'DISTRIBUTION_CENTER', 'BMPL_HUB',
];
const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'];
const MODES = ['LAND', 'AIR', 'SEA'] as const;

interface Hub {
  id: string;
  code: string;
  name: string;
  type: string;
  district: string;
  city: string;
  addressLine1: string | null;
  latitude: number | null;
  longitude: number | null;
  modes: string[];
  courierFeeMinor: number;
  instructions: string | null;
  contactPhone: string | null;
  isActive: boolean;
}

const blank = {
  code: '', name: '', type: 'AIRSTRIP', district: 'BELIZE', city: '',
  addressLine1: '', latitude: '', longitude: '', modes: ['LAND'] as string[],
  instructions: '', contactPhone: '',
};

export default function HubsPage() {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHubs(await api.get<Hub[]>('/admin/logistics/hubs'));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load terminals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setSaving(true);
    setErr(null);
    try {
      await api.post('/admin/logistics/hubs', {
        ...form,
        addressLine1: form.addressLine1 || undefined,
        instructions: form.instructions || undefined,
        contactPhone: form.contactPhone || undefined,
        latitude: form.latitude ? Number(form.latitude) : undefined,
        longitude: form.longitude ? Number(form.longitude) : undefined,
      });
      setForm({ ...blank });
      setNote('Terminal added.');
      await load();
    } catch (e) {
      const api_ = e as ApiError;
      setErr(api_.errors?.[0]?.message ?? api_.message ?? 'Could not add that terminal.');
    } finally {
      setSaving(false);
    }
  }

  /** Toggling active is the operator's fastest, most-used control. */
  async function toggle(hub: Hub) {
    try {
      await api.patch(`/admin/logistics/hubs/${hub.id}`, { isActive: !hub.isActive });
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not update that terminal.');
    }
  }

  async function setFee(hub: Hub, value: string) {
    const dollars = Number(value);
    if (!Number.isFinite(dollars) || dollars < 0) return;
    try {
      // The API takes minor units; operators think in dollars.
      await api.patch(`/admin/logistics/hubs/${hub.id}`, { courierFeeMinor: Math.round(dollars * 100) });
      setNote(`Courier rate for ${hub.name} saved.`);
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not save that rate.');
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], 'Terminals')}
        title="Terminals"
        description="Airstrips, water taxi terminals, depots. The route planner only knows what is listed here."
      />

      {err && <Alert tone="warning" className="mb-4">{err}</Alert>}
      {note && <Alert tone="success" className="mb-4">{note}</Alert>}

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Add a terminal</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Code" htmlFor="hub-code" hint="Short handle, e.g. SPA. Used by operators and by the planner.">
            <Input id="hub-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SPA" />
          </Field>
          <Field label="Name" htmlFor="hub-name">
            <Input id="hub-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="San Pedro Airstrip" />
          </Field>
          <Field label="Type" htmlFor="hub-type">
            <Select id="hub-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {HUB_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>
              ))}
            </Select>
          </Field>
          <Field label="District" htmlFor="hub-district">
            <Select id="hub-district" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })}>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </Field>
          <Field label="Town" htmlFor="hub-city" hint="What separates two terminals in the same district.">
            <Input id="hub-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="San Pedro" />
          </Field>
          <Field label="Address" htmlFor="hub-address">
            <Input id="hub-address" value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
          </Field>
          <Field label="Latitude" htmlFor="hub-lat" hint="Optional. Used for driver navigation.">
            <Input id="hub-lat" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="17.9139" />
          </Field>
          <Field label="Longitude" htmlFor="hub-lng">
            <Input id="hub-lng" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="-87.9711" />
          </Field>
          <Field label="Contact phone" htmlFor="hub-phone">
            <Input id="hub-phone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Modes it can handle" hint="An airstrip cannot take a boat; the planner will not route one to it.">
              <div className="flex flex-wrap gap-2">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        modes: form.modes.includes(m) ? form.modes.filter((x) => x !== m) : [...form.modes, m],
                      })
                    }
                    className={`min-h-[40px] rounded-full border px-4 text-sm font-medium ${
                      form.modes.includes(m) ? 'border-belize-blue bg-belize-blue text-white' : 'border-slate-300 text-slate-700'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Counter instructions" htmlFor="hub-instructions" hint="Shown to whoever drops off or collects — hours, which desk.">
              <Input id="hub-instructions" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
            </Field>
          </div>
        </div>
        <Button onClick={create} disabled={saving || !form.code || !form.name || !form.city || form.modes.length === 0} className="mt-3">
          {saving ? 'Adding…' : 'Add terminal'}
        </Button>
      </Card>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {hubs.map((h) => (
            <Card key={h.id} className={`p-4 ${h.isActive ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900">{h.code}</span>
                    <span className="break-words text-sm text-slate-700">{h.name}</span>
                    <Badge tone={h.isActive ? 'success' : 'neutral'}>{h.isActive ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {h.city}, {h.district.replace(/_/g, ' ')} · {h.type.replace(/_/g, ' ').toLowerCase()} · {h.modes.join(', ')}
                  </p>
                  {h.courierFeeMinor === 0 && (
                    // Flagged, because a hub with no rate cannot be sold door-to-door.
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      No courier rate set — door service through this terminal cannot be quoted.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-end gap-2">
                  <Field label="Courier rate (BZ$)">
                    <Input
                      defaultValue={(h.courierFeeMinor / 100).toFixed(2)}
                      onBlur={(e) => void setFee(h, e.target.value)}
                      inputMode="decimal"
                      className="w-28"
                    />
                  </Field>
                  <Button variant="outline" onClick={() => void toggle(h)}>
                    {h.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../../../../components/ui';

/**
 * Courier lanes: two towns one courier can drive between.
 *
 * WHY THIS SCREEN EXISTS. The planner recognises exactly one journey that
 * obviously needs no terminal — both ends in the same town. Everything else went
 * to the terminal network, so Belize City → Ladyville, fifteen minutes up the
 * Northern Highway, was refused unless somebody invented a bus station at each
 * end to describe it.
 *
 * It could not be guessed. Belize City and San Pedro are also one district
 * apart and one of them is on an island; a district-wide rule would have sent a
 * road courier across open water. Which towns share a road is a fact about
 * Belize, and facts about Belize are rows an operator enters here — never code.
 *
 * A LANE IS NOT A TERMINAL. Nothing is handed over, nothing is stored, no
 * counter opens. Lanes never appear in the terminal list a customer picks from.
 */

const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'];

interface Lane {
  id: string;
  originDistrict: string;
  originCity: string;
  destinationDistrict: string;
  destinationCity: string;
  priceMinor: number;
  durationMinutes: number;
  note: string | null;
  isActive: boolean;
  isTest: boolean;
}

const blank = {
  originDistrict: 'BELIZE',
  originCity: '',
  destinationDistrict: 'BELIZE',
  destinationCity: '',
  price: '',
  durationMinutes: '',
  note: '',
  isTest: false,
};

const money = (minor: number) => `BZ$${(minor / 100).toFixed(2)}`;

const where = (district: string, city: string) => `${city}, ${district.replace(/_/g, ' ')}`;

export default function CourierLanesPage() {
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLanes(await api.get<Lane[]>('/admin/logistics/courier-lanes'));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load courier lanes.');
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
    setNote(null);
    try {
      await api.post('/admin/logistics/courier-lanes', {
        originDistrict: form.originDistrict,
        originCity: form.originCity.trim(),
        destinationDistrict: form.destinationDistrict,
        destinationCity: form.destinationCity.trim(),
        // Operators think in dollars; the API takes minor units.
        priceMinor: form.price ? Math.round(Number(form.price) * 100) : 0,
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : 0,
        note: form.note.trim() || undefined,
        isTest: form.isTest,
      });
      setForm({ ...blank });
      setNote('Lane added.');
      await load();
    } catch (e) {
      const failure = e as ApiError;
      setErr(failure.errors?.[0]?.message ?? failure.message ?? 'Could not add that lane.');
    } finally {
      setSaving(false);
    }
  }

  /** Closing a lane — a bridge out, a flooded road — is the fastest control here. */
  async function toggle(lane: Lane) {
    try {
      await api.patch(`/admin/logistics/courier-lanes/${lane.id}`, { isActive: !lane.isActive });
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not update that lane.');
    }
  }

  async function setPrice(lane: Lane, value: string) {
    const dollars = Number(value);
    if (!Number.isFinite(dollars) || dollars < 0) return;
    if (Math.round(dollars * 100) === lane.priceMinor) return;
    try {
      await api.patch(`/admin/logistics/courier-lanes/${lane.id}`, { priceMinor: Math.round(dollars * 100) });
      setNote(`Rate for ${lane.originCity} → ${lane.destinationCity} saved.`);
      await load();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not save that rate.');
    }
  }

  const bothTowns = form.originCity.trim() && form.destinationCity.trim();

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], 'Courier lanes')}
        title="Courier lanes"
        description="Two towns one courier can drive between, door to door, with no terminal in between."
      />

      <Alert tone="info" className="mb-4">
        A lane says only that a road connects two towns and what BML charges to run it. It is not a terminal, it is
        never shown to customers as a service, and adding one does not imply anything about any other pair of towns.
      </Alert>

      {err && (
        <Alert tone="warning" className="mb-4">
          {err}
        </Alert>
      )}
      {note && (
        <Alert tone="success" className="mb-4">
          {note}
        </Alert>
      )}

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Add a lane</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From district" htmlFor="lane-from-district">
            <Select
              id="lane-from-district"
              value={form.originDistrict}
              onChange={(e) => setForm({ ...form, originDistrict: e.target.value })}
            >
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {d.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From town" htmlFor="lane-from-city">
            <Input
              id="lane-from-city"
              value={form.originCity}
              onChange={(e) => setForm({ ...form, originCity: e.target.value })}
              placeholder="Belize City"
            />
          </Field>
          <Field label="To district" htmlFor="lane-to-district">
            <Select
              id="lane-to-district"
              value={form.destinationDistrict}
              onChange={(e) => setForm({ ...form, destinationDistrict: e.target.value })}
            >
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {d.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To town" htmlFor="lane-to-city">
            <Input
              id="lane-to-city"
              value={form.destinationCity}
              onChange={(e) => setForm({ ...form, destinationCity: e.target.value })}
              placeholder="Ladyville"
            />
          </Field>
          <Field
            label="Rate (BZ$)"
            htmlFor="lane-price"
            hint="What BML charges for the whole run. Leave blank to add the lane unpriced — it will not be quoted until a rate is set."
          >
            <Input
              id="lane-price"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              inputMode="decimal"
              placeholder="25.00"
            />
          </Field>
          <Field label="Typical minutes" htmlFor="lane-minutes" hint="Travel time, not a promised arrival.">
            <Input
              id="lane-minutes"
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
              inputMode="numeric"
              placeholder="40"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note for operations" htmlFor="lane-note" hint="Never shown to a customer.">
              <Input
                id="lane-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Northern Highway, no ferry"
              />
            </Field>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.isTest}
                onChange={(e) => setForm({ ...form, isTest: e.target.checked })}
              />
              {/* The same boundary hubs and routes already sit either side of: a
                  simulation lane exists to exercise the planner and can never
                  carry a real parcel. */}
              Simulation lane — for testing the planner only, never offered to a real customer
            </label>
          </div>
        </div>
        <Button onClick={create} disabled={saving || !bothTowns} className="mt-3">
          {saving ? 'Adding…' : 'Add lane'}
        </Button>
      </Card>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : lanes.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No courier lanes configured"
            description="Journeys within one town are already direct. Anything between two towns goes to the terminal network until a lane says a courier can drive it."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {lanes.map((l) => (
            <Card key={l.id} className={`p-4 ${l.isActive ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-sm font-semibold text-slate-900">
                      {where(l.originDistrict, l.originCity)} ↔ {where(l.destinationDistrict, l.destinationCity)}
                    </span>
                    <Badge tone={l.isActive ? 'success' : 'neutral'}>{l.isActive ? 'Open' : 'Closed'}</Badge>
                    {l.isTest && <Badge tone="neutral">Simulation</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {money(l.priceMinor)}
                    {l.durationMinutes > 0 ? ` · about ${l.durationMinutes} min` : ''} · both directions
                  </p>
                  {l.note && <p className="mt-1 break-words text-xs text-slate-500">{l.note}</p>}
                  {l.priceMinor === 0 && (
                    // Flagged, like an unpriced terminal: the lane exists but
                    // nothing can be sold down it yet.
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      No rate set — this lane cannot be quoted.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-end gap-2">
                  <Field label="Rate (BZ$)">
                    <Input
                      defaultValue={(l.priceMinor / 100).toFixed(2)}
                      onBlur={(e) => void setPrice(l, e.target.value)}
                      inputMode="decimal"
                      className="w-28"
                      aria-label={`Rate for ${l.originCity} to ${l.destinationCity}`}
                    />
                  </Field>
                  <Button variant="outline" onClick={() => void toggle(l)}>
                    {l.isActive ? 'Close lane' : 'Open lane'}
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

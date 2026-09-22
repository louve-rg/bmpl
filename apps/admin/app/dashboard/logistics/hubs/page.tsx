'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { hubEditFormValid, hubEditPatch, hubToForm, type EditableHub, type HubEditForm } from '../../../../lib/hub-edit';
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

interface Hub extends EditableHub {
  code: string;
  district: string;
  city: string;
  courierFeeMinor: number;
  isActive: boolean;
  isTest?: boolean;
}

const blank = {
  code: '', name: '', type: 'AIRSTRIP', district: 'BELIZE', city: '',
  addressLine1: '', latitude: '', longitude: '', modes: ['LAND'] as string[],
  instructions: '', contactPhone: '',
};

function ModesPicker({ modes, onToggle }: { modes: string[]; onToggle: (m: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onToggle(m)}
          className={`min-h-[40px] rounded-full border px-4 text-sm font-medium ${
            modes.includes(m) ? 'border-belize-blue bg-belize-blue text-white' : 'border-slate-300 text-slate-700'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export default function HubsPage() {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<HubEditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

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

  // The edit affordance is drawn only for logistics.manage — /me returns the
  // same grant rows the PermissionsGuard evaluates (BMPL-47), so what this
  // screen shows and what the API enforces cannot disagree. On any doubt
  // (request fails, field absent) it stays hidden: fail closed.
  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => setCanManage((me.adminPermissions ?? []).includes('logistics.manage')))
      .catch(() => setCanManage(false));
  }, []);

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

  function startEdit(hub: Hub) {
    setEditingId(hub.id);
    setEdit(hubToForm(hub));
    setNote(null);
    setErr(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEdit(null);
  }

  async function saveEdit(hub: Hub) {
    if (!edit) return;
    const patch = hubEditPatch(hub, edit);
    if (Object.keys(patch).length === 0) {
      cancelEdit();
      return;
    }
    setSavingEdit(true);
    setErr(null);
    try {
      await api.patch(`/admin/logistics/hubs/${hub.id}`, patch);
      setNote(`${hub.code} updated. Routes and history keep pointing at it — the id never changes.`);
      cancelEdit();
      await load();
    } catch (e) {
      const api_ = e as ApiError;
      setErr(api_.errors?.[0]?.message ?? api_.message ?? 'Could not save those changes.');
    } finally {
      setSavingEdit(false);
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

      {/* Every control below writes through logistics.manage-guarded routes,
          so for logistics.read the whole screen reads as a report: no create
          form, no rate input, no toggle — hidden like the Edit button, not
          disabled (BMPL-142, settled ruling). The server stays the authority;
          this only stops drawing buttons that could never work. */}
      {canManage && (
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
              <ModesPicker
                modes={form.modes}
                onToggle={(m) =>
                  setForm({
                    ...form,
                    modes: form.modes.includes(m) ? form.modes.filter((x) => x !== m) : [...form.modes, m],
                  })
                }
              />
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
      )}

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
                    {h.isTest && <Badge tone="neutral">Simulation</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {h.city}, {h.district.replace(/_/g, ' ')} · {h.type.replace(/_/g, ' ').toLowerCase()} · {h.modes.join(', ')}
                  </p>
                  {(h.addressLine1 || h.contactPhone || h.contactName) && editingId !== h.id && (
                    <p className="mt-1 text-xs text-slate-500">
                      {[h.addressLine1, h.addressLine2, h.contactName, h.contactPhone].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {h.courierFeeMinor === 0 && (
                    // Flagged, because a hub with no rate cannot be sold door-to-door.
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      No courier rate set — door service through this terminal cannot be quoted.
                    </p>
                  )}
                </div>
                {canManage && editingId !== h.id && (
                  <div className="flex shrink-0 flex-wrap items-end gap-2">
                    <Field label="Courier rate (BZ$)">
                      <Input
                        defaultValue={(h.courierFeeMinor / 100).toFixed(2)}
                        onBlur={(e) => void setFee(h, e.target.value)}
                        inputMode="decimal"
                        className="w-28"
                      />
                    </Field>
                    <Button variant="outline" onClick={() => startEdit(h)}>Edit</Button>
                    <Button variant="outline" onClick={() => void toggle(h)}>
                      {h.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                )}
                {/* The fee is a fact the report still states; only the
                    control is withheld. */}
                {!canManage && (
                  <p className="shrink-0 text-sm text-slate-600">
                    Courier rate <span className="font-semibold text-belize-navy">BZ${(h.courierFeeMinor / 100).toFixed(2)}</span>
                  </p>
                )}
              </div>

              {editingId === h.id && edit && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-xs text-slate-500">
                    {/* Code, district and town drive planning and identity —
                        the planner attaches doors by town — so changing them is
                        a network decision, not a correction (BMPL-139 ruling). */}
                    Fixed: <span className="font-mono">{h.code}</span> · {h.city}, {h.district.replace(/_/g, ' ')} — the code, town and
                    district place this terminal in the network and are not editable here.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Name" htmlFor={`edit-name-${h.id}`}>
                      <Input id={`edit-name-${h.id}`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                    </Field>
                    <Field label="Type" htmlFor={`edit-type-${h.id}`}>
                      <Select id={`edit-type-${h.id}`} value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                        {HUB_TYPES.map((t) => (
                          <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Address" htmlFor={`edit-addr1-${h.id}`}>
                      <Input id={`edit-addr1-${h.id}`} value={edit.addressLine1} onChange={(e) => setEdit({ ...edit, addressLine1: e.target.value })} />
                    </Field>
                    <Field label="Address line 2" htmlFor={`edit-addr2-${h.id}`}>
                      <Input id={`edit-addr2-${h.id}`} value={edit.addressLine2} onChange={(e) => setEdit({ ...edit, addressLine2: e.target.value })} />
                    </Field>
                    <Field label="Latitude" htmlFor={`edit-lat-${h.id}`} hint="A saved pin can be moved, not removed. Leave both blank to keep it.">
                      <Input id={`edit-lat-${h.id}`} value={edit.latitude} onChange={(e) => setEdit({ ...edit, latitude: e.target.value })} />
                    </Field>
                    <Field label="Longitude" htmlFor={`edit-lng-${h.id}`}>
                      <Input id={`edit-lng-${h.id}`} value={edit.longitude} onChange={(e) => setEdit({ ...edit, longitude: e.target.value })} />
                    </Field>
                    <Field label="Contact name" htmlFor={`edit-cname-${h.id}`}>
                      <Input id={`edit-cname-${h.id}`} value={edit.contactName} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} />
                    </Field>
                    <Field label="Contact phone" htmlFor={`edit-cphone-${h.id}`} hint="Leave blank to keep the current number.">
                      <Input id={`edit-cphone-${h.id}`} value={edit.contactPhone} onChange={(e) => setEdit({ ...edit, contactPhone: e.target.value })} />
                    </Field>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <Field label="Modes it can handle" hint="An airstrip cannot take a boat; the planner will not route one to it.">
                        <ModesPicker
                          modes={edit.modes}
                          onToggle={(m) =>
                            setEdit({
                              ...edit,
                              modes: edit.modes.includes(m) ? edit.modes.filter((x) => x !== m) : [...edit.modes, m],
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <Field label="Counter instructions" htmlFor={`edit-instr-${h.id}`} hint="Shown to whoever drops off or collects — hours, which desk.">
                        <Input id={`edit-instr-${h.id}`} value={edit.instructions} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} />
                      </Field>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={() => void saveEdit(h)} disabled={savingEdit || !hubEditFormValid(edit)}>
                      {savingEdit ? 'Saving…' : 'Save changes'}
                    </Button>
                    <Button variant="outline" onClick={cancelEdit} disabled={savingEdit}>Cancel</Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

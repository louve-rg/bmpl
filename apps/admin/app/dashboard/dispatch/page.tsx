'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, Card, EmptyState, Field, PageHeader, Select, Spinner } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

interface DeliveryRow {
  id: string;
  status: string;
  statusLabel: string;
  orderNumber: string;
  vendorOrderNumber: string | null;
  vendor: string | null;
  district: string | null;
  city: string | null;
  feeMinor: number | null;
  driver: string | null;
  createdAt: string;
}

const STATUSES = [
  'PENDING_ASSIGNMENT',
  'ASSIGNED',
  'DRIVER_ACCEPTED',
  'DRIVER_DECLINED',
  'PICKUP_CONFIRMED',
  'IN_TRANSIT',
  'ARRIVING',
  'DELIVERED',
  'CANCELLED',
];

const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'];

function money(n: number | null): string {
  return n == null ? '—' : `$${(n / 100).toFixed(2)}`;
}

export default function DispatchPage() {
  const [status, setStatus] = useState('');
  const [district, setDistrict] = useState('');
  const [unassigned, setUnassigned] = useState(false);
  // Assignment mode lives in platform settings and is read by the dispatch
  // engine on every tick, so flipping it takes effect without a deploy.
  const [autoDispatch, setAutoDispatch] = useState<boolean | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeErr, setModeErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ dispatchAutomatic: boolean }>('/admin/ops/settings')
      .then((s) => setAutoDispatch(s.dispatchAutomatic))
      .catch(() => setAutoDispatch(null));
  }, []);

  async function setMode(automatic: boolean) {
    setModeBusy(true);
    setModeErr(null);
    try {
      await api.patch('/admin/ops/settings', { dispatchAutomatic: automatic });
      setAutoDispatch(automatic);
    } catch (e) {
      setModeErr((e as ApiError).message ?? 'Could not change the assignment mode.');
    } finally {
      setModeBusy(false);
    }
  }
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(s: string, d: string, u: boolean) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (s) params.set('status', s);
      if (d) params.set('district', d);
      if (u) params.set('unassigned', 'true');
      const qs = params.toString();
      setRows(await api.get<DeliveryRow[]>(`/admin/deliveries${qs ? `?${qs}` : ''}`));
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 403 ? 'You do not have permission to view deliveries.' : err.message ?? 'Failed to load deliveries.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(status, district, unassigned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, district, unassigned]);

  return (
    <div>
      <PageHeader breadcrumbs={adminCrumbs('Dispatch')} eyebrow="Logistics" title="Dispatch" description="Assign, track and manage delivery execution." />

      {/* One switch, two modes, and a plain description of what each does. There
          is only ever ONE assignment engine underneath — automatic lets it choose
          the driver, manual leaves the choice to an operator on the delivery. */}
      <Card className="mb-4 p-4">
        <h2 className="text-sm font-semibold text-slate-900">Assignment mode</h2>
        {modeErr && <Alert tone="warning" className="mt-2">{modeErr}</Alert>}
        {autoDispatch == null ? (
          <p className="mt-1 text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { on: true, label: 'Automatic', hint: 'The dispatch engine offers each delivery to the best eligible driver.' },
                { on: false, label: 'Manual', hint: 'Deliveries wait for an operator to choose a driver.' },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  disabled={modeBusy}
                  aria-pressed={autoDispatch === opt.on}
                  onClick={() => void setMode(opt.on)}
                  className={`min-h-[44px] rounded-bmpl-md border px-4 text-sm font-medium transition ${
                    autoDispatch === opt.on
                      ? 'border-belize-blue bg-belize-blue text-white'
                      : 'border-slate-300 text-slate-700 hover:border-slate-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {autoDispatch
                ? 'The dispatch engine offers each ready delivery to the best eligible driver, one at a time.'
                : 'Deliveries stay unassigned until an operator picks a driver from the eligible list.'}
            </p>
          </>
        )}
      </Card>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
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
        <Field label="Assignment">
          <label className="flex h-[42px] items-center gap-2 rounded-bmpl-md border border-slate-300 bg-white px-3 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={unassigned}
              onChange={(e) => setUnassigned(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
            />
            Unassigned only
          </label>
        </Field>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : error ? (
        <p className="rounded-bmpl-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No deliveries found" description="Try adjusting the filters above." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">District / City</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Fee</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-belize-navy">{r.orderNumber}</p>
                    {r.vendorOrderNumber && <p className="text-xs text-slate-500">{r.vendorOrderNumber}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{r.vendor ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {r.district ? r.district.replace(/_/g, ' ') : '—'}
                    {r.city ? ` · ${r.city}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{r.driver ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{money(r.feeMinor)}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/dispatch/${r.id}`} className="font-semibold text-belize-blue hover:underline">
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

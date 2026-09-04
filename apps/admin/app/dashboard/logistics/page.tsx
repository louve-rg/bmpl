'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../lib/api';
import { adminCrumbs } from '../../../lib/admin-nav';
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader, Select, Spinner } from '../../../components/ui';

/**
 * The logistics operations board.
 *
 * Sorted by "needs a human first" rather than by date — an operations list
 * ordered purely by time makes the one shipment in trouble exactly as hard to
 * find as the ninety that are fine. Exceptions come first, then anything whose
 * courier leg ran out of drivers, then the rest.
 */

interface OpsLeg {
  id: string;
  sequence: number;
  kind: string;
  mode: string;
  status: string;
  courierStatus: string | null;
  from: string;
  to: string;
  operator: string | null;
  needsDriver: boolean;
}

interface OpsRow {
  id: string;
  reference: string;
  serviceLabel: string;
  status: string;
  statusLabel: string;
  isTest: boolean;
  customer: string | null;
  origin: string | null;
  destination: string | null;
  totalMinor: number;
  exceptionReason: string | null;
  needsAttention: boolean;
  needsDriver: boolean;
  createdAt: string;
  legs: OpsLeg[];
}

const STATUSES = [
  'AWAITING_PICKUP', 'FIRST_MILE', 'AT_ORIGIN_HUB', 'IN_TRANSIT',
  'AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY', 'AWAITING_COLLECTION',
  'DELIVERED', 'EXCEPTION', 'CANCELLED',
];

const money = (n: number) => `$${(n / 100).toFixed(2)}`;

/** The leg's own state, in the vocabulary the operator uses out loud. */
function legState(leg: OpsLeg): { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' } {
  if (leg.status === 'COMPLETED') return { label: 'Done', tone: 'success' };
  if (leg.status === 'EXCEPTION') return { label: 'Problem', tone: 'warning' };
  if (leg.status === 'CANCELLED') return { label: 'Cancelled', tone: 'neutral' };
  if (leg.needsDriver) return { label: 'No driver found', tone: 'warning' };
  if (leg.status === 'IN_PROGRESS') return { label: 'Moving', tone: 'info' };
  if (leg.status === 'READY') return { label: 'Ready', tone: 'info' };
  return { label: 'Waiting', tone: 'neutral' };
}

export default function LogisticsOpsPage() {
  const [rows, setRows] = useState<OpsRow[]>([]);
  const [status, setStatus] = useState('');
  const [includeTest, setIncludeTest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (includeTest) qs.set('includeTest', 'true');
      const res = await api.get<{ rows: OpsRow[] }>(`/admin/logistics/shipments?${qs}`);
      setRows(res.rows);
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load shipments.');
    } finally {
      setLoading(false);
    }
  }, [status, includeTest]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs('Logistics')}
        title="Logistics"
        description="Multi-leg shipments across Belize. Local marketplace deliveries live under Dispatch."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/logistics/handoff-desk" className="rounded-bmpl-md border border-slate-300 px-3 py-2 text-sm font-medium">
              Handoff desk
            </Link>
            <Link href="/dashboard/logistics/hubs" className="rounded-bmpl-md border border-slate-300 px-3 py-2 text-sm font-medium">
              Terminals
            </Link>
            <Link href="/dashboard/logistics/routes" className="rounded-bmpl-md border border-slate-300 px-3 py-2 text-sm font-medium">
              Routes
            </Link>
            <Link href="/dashboard/logistics/courier-lanes" className="rounded-bmpl-md border border-slate-300 px-3 py-2 text-sm font-medium">
              Courier lanes
            </Link>
          </div>
        }
      />

      <Card className="mt-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex min-h-[40px] items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
            {/* Off by default so the board reflects real work. */}
            Include simulation shipments
          </label>
          <Button onClick={() => void load()} variant="outline">
            Refresh
          </Button>
        </div>
      </Card>

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}
      {err && <Alert tone="warning" className="mt-4">{err}</Alert>}
      {!loading && !err && rows.length === 0 && (
        <div className="mt-6">
          <EmptyState title="No shipments" description="Nothing matches those filters." />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {rows.map((s) => (
          <Card
            key={s.id}
            className={`p-4 ${s.needsAttention ? 'border-amber-300 bg-amber-50/40' : s.needsDriver ? 'border-amber-200' : ''}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/logistics/${encodeURIComponent(s.reference)}`} className="font-mono text-sm font-semibold text-belize-blue hover:underline">
                    {s.reference}
                  </Link>
                  <Badge tone={s.needsAttention ? 'warning' : 'info'}>{s.statusLabel}</Badge>
                  <Badge tone="neutral">{s.serviceLabel}</Badge>
                  {s.isTest && <Badge tone="neutral">Simulation</Badge>}
                </div>
                <p className="mt-1 break-words text-sm text-slate-600">
                  {[s.origin, s.destination].filter(Boolean).join(' → ') || '—'}
                </p>
                {s.customer && <p className="mt-0.5 text-xs text-slate-500">{s.customer}</p>}
                {s.exceptionReason && (
                  <p className="mt-1 break-words text-sm font-medium text-amber-800">{s.exceptionReason}</p>
                )}
                {s.needsDriver && !s.needsAttention && (
                  <p className="mt-1 text-sm font-medium text-amber-800">
                    A courier leg ran out of drivers — it needs assigning by hand.
                  </p>
                )}
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{money(s.totalMinor)}</p>
            </div>

            {/* The legs inline: an operator scanning the board should not have to
                open a shipment to see which step is stuck. */}
            <ol className="mt-3 flex flex-wrap gap-2">
              {s.legs.map((leg) => {
                const state = legState(leg);
                return (
                  <li key={leg.id} className="rounded-bmpl-md border border-slate-200 bg-white px-2 py-1 text-xs">
                    <span className="font-medium text-slate-700">
                      {leg.sequence}. {leg.from} → {leg.to}
                    </span>
                    <Badge tone={state.tone} className="ml-1.5">
                      {state.label}
                    </Badge>
                    {leg.operator && <span className="ml-1.5 text-slate-500">{leg.operator}</span>}
                  </li>
                );
              })}
            </ol>
          </Card>
        ))}
      </div>
    </div>
  );
}

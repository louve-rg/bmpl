'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../lib/api';
import { adminCrumbs } from '../../../lib/admin-nav';
import { legAssignMode } from '../../../lib/leg-assign';
import { LegAssignModal } from '../../../components/logistics/LegAssignModal';
import { Alert, Badge, Button, Card, EmptyState, Field, LoadingRow, PageHeader, Select } from '../../../components/ui';

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
  /**
   * CLOSE-20: the discriminant behind the flat `needsDriver` boolean above.
   * Optional and possibly absent even when present in the type — this field
   * is new on an already-live response shape, so a deploy where the backend
   * branch adding it hasn't landed yet simply omits the key. Every read of
   * it below falls through to the unchanged `needsDriver`-only behavior when
   * it's missing, so this board renders correctly either way.
   */
  needsDriverReason?: 'EXHAUSTED' | 'UNAVAILABLE' | null;
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
  'DELIVERED', 'EXCEPTION', 'RETURNED', 'REROUTED', 'CANCELLED',
];

const money = (n: number) => `$${(n / 100).toFixed(2)}`;

/**
 * MDF-560 (owner): "booked but no carrier to move it" must read as awaiting
 * fulfilment, not as ordinary progress. A LINE_HAUL leg is never dispatched
 * to a driver — `leg-assign.ts`'s own `legAssignMode` refuses it outright —
 * so `needsDriver` (dispatch exhaustion) can never fire for one, and without
 * this check an unassigned transport leg fell through to the same neutral
 * "Waiting" every ordinarily-queued leg gets. Checked ahead of the generic
 * fallback, same position `needsDriver` already holds for the courier case.
 */
function legNeedsCarrier(leg: OpsLeg): boolean {
  return leg.kind === 'LINE_HAUL' && !leg.operator && leg.status !== 'COMPLETED' && leg.status !== 'CANCELLED' && leg.status !== 'EXCEPTION';
}

/** The leg's own state, in the vocabulary the operator uses out loud. */
function legState(leg: OpsLeg): { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' } {
  if (leg.status === 'COMPLETED') return { label: 'Done', tone: 'success' };
  if (leg.status === 'EXCEPTION') return { label: 'Problem', tone: 'warning' };
  if (leg.status === 'CANCELLED') return { label: 'Cancelled', tone: 'neutral' };
  // CLOSE-20: UNAVAILABLE ("nobody was ever eligible to ask") is a different
  // claim from EXHAUSTED ("we asked everyone and nobody took it") and can
  // resolve on its own the moment a driver comes online, which exhaustion
  // cannot — so it gets its own badge, in a tone that doesn't read as the
  // same hand-assign alarm. The backend already resolves EXHAUSTED first
  // whenever a leg could claim both (see needsDriverReason's own precedence
  // comment), so checking this branch first never shadows an exhausted leg.
  if (leg.needsDriverReason === 'UNAVAILABLE') return { label: 'No driver online', tone: 'info' };
  if (leg.needsDriver) return { label: 'No driver found', tone: 'warning' };
  if (legNeedsCarrier(leg)) return { label: 'No carrier assigned', tone: 'warning' };
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
  const [assigning, setAssigning] = useState<{ leg: OpsLeg; mode: 'assign' | 'reassign' } | null>(null);
  const [hiddenSimulation, setHiddenSimulation] = useState(0);
  const [canOperate, setCanOperate] = useState(false);

  // Assigning/reassigning a courier leg needs logistics.operate — the same
  // permission LegAssignModal's own writes require, so the trigger below and
  // the form it opens can never disagree. /me returns the same grant rows
  // the PermissionsGuard evaluates; on any doubt it stays hidden: fail
  // closed. This board only ever needed logistics.read to load (BMPL-270).
  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => setCanOperate((me.adminPermissions ?? []).includes('logistics.operate')))
      .catch(() => setCanOperate(false));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (includeTest) qs.set('includeTest', 'true');
      const res = await api.get<{ rows: OpsRow[]; total: number }>(`/admin/logistics/shipments?${qs}`);
      setRows(res.rows);
      setErr(null);
      // An empty board with the simulation filter on can be hiding the very
      // shipment somebody is walking through UAT with. One cheap count answers
      // "is there really nothing?" honestly instead of leaving it ambiguous.
      if (res.rows.length === 0 && !includeTest) {
        const withTest = await api.get<{ total: number }>(
          `/admin/logistics/shipments?${new URLSearchParams({ ...(status ? { status } : {}), includeTest: 'true', pageSize: '1' })}`,
        );
        setHiddenSimulation(Math.max(0, withTest.total - res.total));
      } else {
        setHiddenSimulation(0);
      }
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
            <Link href="/dashboard/logistics/providers" className="rounded-bmpl-md border border-slate-300 px-3 py-2 text-sm font-medium">
              Carriers
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
          <label className="flex min-h-[40px] items-center gap-2 text-sm text-[color:var(--bmpl-text-muted-strong)]">
            <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
            {/* Off by default so the board reflects real work. */}
            Include simulation shipments
          </label>
          <Button onClick={() => void load()} variant="outline">
            Refresh
          </Button>
        </div>
      </Card>

      {loading && <LoadingRow className="mt-6" />}
      {err && <Alert tone="warning" className="mt-4">{err}</Alert>}
      {!loading && !err && rows.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="No shipments"
            description={
              hiddenSimulation > 0
                ? `Nothing matches those filters — but ${hiddenSimulation} simulation shipment${hiddenSimulation === 1 ? ' is' : 's are'} hidden by "Include simulation shipments".`
                : 'Nothing matches those filters.'
            }
            action={
              hiddenSimulation > 0 ? (
                <Button variant="outline" onClick={() => setIncludeTest(true)}>
                  Show simulation shipments
                </Button>
              ) : undefined
            }
          />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {rows.map((s) => {
        const needsCarrier = s.legs.some(legNeedsCarrier);
        // CLOSE-20: the shipment-level `needsDriver` boolean is still an
        // aggregate across legs with no reason of its own (Pam's contract —
        // a reason is a per-leg concept), but every leg that set it DOES
        // carry a reason once this field exists, so whether EXHAUSTED is
        // among them is still derivable here with no new data path. Where
        // the field is absent entirely (old deploy), `driverReasons` is
        // empty and this falls back to treating `needsDriver` as exhaustion,
        // exactly the card's pre-CLOSE-20 behavior.
        const driverReasons = s.legs.map((l) => l.needsDriverReason).filter((r): r is 'EXHAUSTED' | 'UNAVAILABLE' => !!r);
        const hasExhausted = driverReasons.includes('EXHAUSTED') || (s.needsDriver && driverReasons.length === 0);
        const hasUnavailableOnly = s.needsDriver && !hasExhausted;
        return (
          <Card
            key={s.id}
            className={`p-4 ${
              s.needsAttention
                ? 'border-amber-300 bg-amber-50/40'
                : hasExhausted || needsCarrier
                  ? 'border-amber-200'
                  : hasUnavailableOnly
                    ? 'border-sky-200'
                    : ''
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/logistics/${encodeURIComponent(s.reference)}`} className="font-mono text-sm font-semibold text-[color:var(--bmpl-link)] hover:underline">
                    {s.reference}
                  </Link>
                  <Badge tone={s.needsAttention ? 'warning' : 'info'}>{s.statusLabel}</Badge>
                  <Badge tone="neutral">{s.serviceLabel}</Badge>
                  {s.isTest && <Badge tone="neutral">Simulation</Badge>}
                </div>
                <p className="mt-1 break-words text-sm text-[color:var(--bmpl-text-muted-strong)]">
                  {[s.origin, s.destination].filter(Boolean).join(' → ') || '—'}
                </p>
                {s.customer && <p className="mt-0.5 text-xs text-[color:var(--bmpl-text-muted)]">{s.customer}</p>}
                {s.exceptionReason && (
                  <p className="mt-1 break-words text-sm font-medium text-amber-800">{s.exceptionReason}</p>
                )}
                {hasExhausted && !s.needsAttention && (
                  <p className="mt-1 text-sm font-medium text-amber-800">
                    A courier leg ran out of drivers — it needs assigning by hand.
                  </p>
                )}
                {hasUnavailableOnly && !s.needsAttention && (
                  <p className="mt-1 text-sm font-medium text-sky-800">
                    No driver is currently online for a courier leg. It may resolve on its own, or you can assign one by hand.
                  </p>
                )}
                {needsCarrier && !s.needsAttention && (
                  <p className="mt-1 text-sm font-medium text-amber-800">
                    A transport leg has no carrier assigned yet — it needs assigning by hand.
                  </p>
                )}
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-[color:var(--bmpl-text)]">{money(s.totalMinor)}</p>
            </div>

            {/* The legs inline: an operator scanning the board should not have to
                open a shipment to see which step is stuck. */}
            <ol className="mt-3 flex flex-wrap gap-2">
              {s.legs.map((leg) => {
                const state = legState(leg);
                const mode = legAssignMode(s.legs, leg);
                return (
                  <li key={leg.id} className="rounded-bmpl-md border border-slate-200 bg-white px-2 py-1 text-xs">
                    <span className="font-medium text-slate-700">
                      {leg.sequence}. {leg.from} → {leg.to}
                    </span>
                    <Badge tone={state.tone} className="ml-1.5">
                      {state.label}
                    </Badge>
                    {leg.operator && <span className="ml-1.5 text-slate-500">{leg.operator}</span>}
                    {canOperate && mode && (
                      <button
                        type="button"
                        onClick={() => setAssigning({ leg, mode })}
                        className="ml-1.5 font-medium text-belize-blue hover:underline"
                      >
                        {mode === 'assign' ? 'Assign driver' : 'Reassign'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>
        );
        })}
      </div>

      {assigning && (
        <LegAssignModal
          legId={assigning.leg.id}
          mode={assigning.mode}
          currentOperator={assigning.leg.operator}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

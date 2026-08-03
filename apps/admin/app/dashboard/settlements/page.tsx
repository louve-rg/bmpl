'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  type Tone,
} from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

/* --------------------------------------------------------------- types */

interface Reconciliation {
  escrowBalanceMinor: number;
  platformRevenueMinor: number;
  pendingVendorLiabilityMinor: number;
  pendingDriverLiabilityMinor: number;
  globalLedgerNetMinor: number;
  balanced: boolean;
  failedSettlements: number;
}

interface Account {
  id: string;
  type: string;
  currency: string;
  status: string;
  cachedBalanceMinor: number;
}

interface FeeConfig {
  id: string;
  currency: string;
  commissionBps: number;
  driverEarningMethod: 'FLAT' | 'PERCENT_DELIVERY_FEE' | 'HYBRID';
  driverFlatMinor: number;
  driverDeliveryFeeBps: number;
  defaults: { commissionBps: number; driverDeliveryFeeBps: number };
}

interface Settlement {
  id: string;
  vendorOrderId: string;
  orderNumber: string | null;
  currency: string;
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  commissionMinor: number;
  driverAllocationMinor: number;
  platformFeeMinor: number;
  grossMinor: number;
  netMinor: number;
  status: 'PENDING' | 'POSTED' | 'FAILED';
  failureReason: string | null;
  calculatedAt: string;
  postedAt: string | null;
}

interface AdminSettlement extends Settlement {
  vendor: string | null;
}

interface DriverEarning {
  id: string;
  vendorOrderId: string;
  currency: string;
  method: string;
  grossMinor: number;
  adjustmentsMinor: number;
  netMinor: number;
  status: string;
}

interface Snapshot {
  config?: { commissionBps?: number; driverEarningMethod?: string; driverFlatMinor?: number; driverDeliveryFeeBps?: number };
  inputs?: { merchandiseSubtotalMinor?: number; deliveryFeeMinor?: number; hasDelivery?: boolean };
  breakdown?: Record<string, number>;
}

type AdminSettlementDetail = AdminSettlement & { snapshot?: Snapshot | null; driverEarnings: DriverEarning[] };

interface Exception {
  id: string;
  vendorOrderId: string;
  orderNumber: string | null;
  failureReason: string | null;
  updatedAt: string;
}

/* --------------------------------------------------------------- helpers */

function money(n: number | null | undefined, currency = 'BZD'): string {
  if (n == null) return '—';
  return `${currency === 'USD' ? 'US$' : '$'}${(n / 100).toFixed(2)}`;
}
function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}
function isForbidden(e: unknown): boolean {
  return (e as ApiError)?.status === 403;
}
function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}
function methodLabel(m: string): string {
  switch (m) {
    case 'FLAT':
      return 'Flat rate';
    case 'PERCENT_DELIVERY_FEE':
      return '% of delivery fee';
    case 'HYBRID':
      return 'Flat + % of delivery fee';
    default:
      return m.replace(/_/g, ' ');
  }
}
function accountLabel(type: string): string {
  return type.replace(/^SYSTEM_/, '').replace(/_/g, ' ');
}

/* ----------------------------------------------------------------- page */

export default function AdminSettlementsPage() {
  // `readOnly` becomes true if any manage action (fee-config PATCH / retry) is
  // rejected with 403 — we then hide edit/retry controls for read-only admins.
  const [readOnly, setReadOnly] = useState(false);
  const onForbidden = useCallback(() => setReadOnly(true), []);

  return (
    <div className="space-y-8">
      <PageHeader breadcrumbs={adminCrumbs('Settlements')} eyebrow="Finance" title="Settlements & Escrow" description="Reconciliation, internal balances, settlement history and platform fee configuration. Money is read-only — no manual balance or ledger edits." />

      {readOnly && (
        <Alert tone="info" title="Read-only access">
          You can view settlements but not change fee configuration or retry failed settlements.
        </Alert>
      )}

      <ReconciliationSection />
      <AccountsSection />
      <FeeConfigSection readOnly={readOnly} onForbidden={onForbidden} />
      <SettlementsSection />
      <ExceptionsSection readOnly={readOnly} onForbidden={onForbidden} />
    </div>
  );
}

/* ------------------------------------------------------ reconciliation */

function ReconciliationSection() {
  const [data, setData] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get<Reconciliation>('/admin/settlements/reconciliation');
        if (active) setData(d);
      } catch (e) {
        if (active) setError(isForbidden(e) ? 'You do not have permission to view reconciliation.' : errMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading reconciliation…
      </div>
    );
  }
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return null;

  return (
    <section>
      <div className={`rounded-bmpl-xl border p-5 ${data.balanced ? 'border-emerald-200 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Global ledger net</p>
            <p className={`text-3xl font-bold ${data.balanced ? 'text-emerald-700' : 'text-red-700'}`}>{money(data.globalLedgerNetMinor)}</p>
          </div>
          {data.balanced ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white">
              <span className="h-2 w-2 rounded-full bg-white" aria-hidden /> Balanced ✓
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white">
              <span className="h-2 w-2 rounded-full bg-white" aria-hidden /> IMBALANCE
            </span>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ReconTile label="Escrow balance" value={money(data.escrowBalanceMinor)} />
          <ReconTile label="Platform revenue" value={money(data.platformRevenueMinor)} />
          <ReconTile label="Pending vendor liability" value={money(data.pendingVendorLiabilityMinor)} />
          <ReconTile label="Pending driver liability" value={money(data.pendingDriverLiabilityMinor)} />
        </div>
        {data.failedSettlements > 0 && (
          <p className="mt-4 text-sm font-medium text-red-700">
            {data.failedSettlements} failed settlement{data.failedSettlements === 1 ? '' : 's'} need review — see Exceptions below.
          </p>
        )}
      </div>
    </section>
  );
}

function ReconTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-bmpl-lg border border-white/60 bg-white/70 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-belize-navy">{value}</p>
    </div>
  );
}

/* --------------------------------------------------------- accounts */

function AccountsSection() {
  const [rows, setRows] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get<Account[]>('/admin/settlements/accounts');
        if (active) setRows(d);
      } catch (e) {
        if (active) setError(isForbidden(e) ? 'You do not have permission to view accounts.' : errMessage(e));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-belize-navy">Internal system accounts</h2>
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : !rows ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No system accounts" description="Escrow and platform accounts appear here once activity occurs." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{accountLabel(a.type)}</p>
                <StatusBadge status={a.status} />
              </div>
              <p className="mt-1.5 text-2xl font-bold text-belize-navy">{money(a.cachedBalanceMinor, a.currency)}</p>
              <p className="mt-1 text-xs text-slate-400">{a.currency}</p>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------- fee config */

function FeeConfigSection({ readOnly, onForbidden }: { readOnly: boolean; onForbidden: () => void }) {
  const [config, setConfig] = useState<FeeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<FeeConfig>('/admin/settlements/fee-config');
      setConfig(d);
      setError(null);
    } catch (e) {
      setError(isForbidden(e) ? 'You do not have permission to view fee configuration.' : errMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-belize-navy">Fee configuration</h2>
        {config && !editing && !readOnly && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit rates
          </Button>
        )}
      </div>

      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : !config ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : editing ? (
        <FeeConfigForm
          config={config}
          onCancel={() => setEditing(false)}
          onForbidden={() => {
            setEditing(false);
            onForbidden();
          }}
          onSaved={async () => {
            setEditing(false);
            await load();
          }}
        />
      ) : (
        <Card className="p-5">
          <p className="mb-4 text-xs text-slate-500">
            These are configurable platform fee rates. Commission and driver-share are shown as percentages (basis points ÷ 100).
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ConfigTile label="Commission" value={`${(config.commissionBps / 100).toFixed(2)}%`} sub={`Default ${(config.defaults.commissionBps / 100).toFixed(2)}%`} />
            <ConfigTile label="Driver earning method" value={methodLabel(config.driverEarningMethod)} />
            <ConfigTile label="Driver flat amount" value={money(config.driverFlatMinor, config.currency)} />
            <ConfigTile label="Driver delivery share" value={`${(config.driverDeliveryFeeBps / 100).toFixed(2)}%`} sub={`Default ${(config.defaults.driverDeliveryFeeBps / 100).toFixed(2)}%`} />
          </div>
        </Card>
      )}
    </section>
  );
}

function ConfigTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-bmpl-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-belize-navy">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function FeeConfigForm({
  config,
  onCancel,
  onSaved,
  onForbidden,
}: {
  config: FeeConfig;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onForbidden: () => void;
}) {
  const [commissionPct, setCommissionPct] = useState((config.commissionBps / 100).toString());
  const [method, setMethod] = useState<FeeConfig['driverEarningMethod']>(config.driverEarningMethod);
  const [flatDollars, setFlatDollars] = useState((config.driverFlatMinor / 100).toFixed(2));
  const [driverSharePct, setDriverSharePct] = useState((config.driverDeliveryFeeBps / 100).toString());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const commissionBps = Math.round(parseFloat(commissionPct) * 100);
    const driverDeliveryFeeBps = Math.round(parseFloat(driverSharePct) * 100);
    const driverFlatMinor = Math.round(parseFloat(flatDollars) * 100);
    if ([commissionBps, driverDeliveryFeeBps, driverFlatMinor].some((n) => Number.isNaN(n))) {
      setErr('Enter valid numbers for all rates.');
      return;
    }
    if (commissionBps < 0 || commissionBps > 5000) return setErr('Commission must be between 0% and 50%.');
    if (driverDeliveryFeeBps < 0 || driverDeliveryFeeBps > 10000) return setErr('Driver delivery share must be between 0% and 100%.');
    if (driverFlatMinor < 0 || driverFlatMinor > 1_000_000) return setErr('Driver flat amount is out of range.');

    setBusy(true);
    setErr(null);
    try {
      await api.patch('/admin/settlements/fee-config', {
        commissionBps,
        driverEarningMethod: method,
        driverFlatMinor,
        driverDeliveryFeeBps,
      });
      await onSaved();
    } catch (e) {
      if (isForbidden(e)) {
        onForbidden();
        return;
      }
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Commission (%)" hint="0–50%. Percentage of merchandise subtotal.">
          <Input type="number" step="0.01" min="0" max="50" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} />
        </Field>
        <Field label="Driver earning method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as FeeConfig['driverEarningMethod'])}>
            <option value="FLAT">Flat rate</option>
            <option value="PERCENT_DELIVERY_FEE">% of delivery fee</option>
            <option value="HYBRID">Flat + % of delivery fee</option>
          </Select>
        </Field>
        <Field label={`Driver flat amount (${config.currency})`} hint="Used by Flat and Hybrid methods.">
          <Input type="number" step="0.01" min="0" value={flatDollars} onChange={(e) => setFlatDollars(e.target.value)} />
        </Field>
        <Field label="Driver delivery share (%)" hint="0–100%. Share of the delivery fee paid to the driver.">
          <Input type="number" step="0.01" min="0" max="100" value={driverSharePct} onChange={(e) => setDriverSharePct(e.target.value)} />
        </Field>
      </div>

      {err && <p className="mt-3 text-sm font-medium text-red-600">{err}</p>}

      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Save fee configuration'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------- settlements */

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'FAILED', label: 'Failed' },
];

function SettlementsSection() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<AdminSettlement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    setRows(null);
    setError(null);
    try {
      const qs = s ? `?status=${s}` : '';
      setRows(await api.get<AdminSettlement[]>(`/admin/settlements${qs}`));
    } catch (e) {
      setError(isForbidden(e) ? 'You do not have permission to view settlements.' : errMessage(e));
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-belize-navy">Settlements</h2>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => setStatus(f.value)}
              aria-pressed={active}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                active ? 'bg-belize-blue text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : !rows ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No settlements found" description="Try a different status filter." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Commission</th>
                <th className="px-4 py-3 text-right">Driver</th>
                <th className="px-4 py-3 text-right">Platform fee</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = openId === r.id;
                return <AdminRowGroup key={r.id} settlement={r} open={open} onToggle={() => setOpenId(open ? null : r.id)} />;
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AdminRowGroup({ settlement: r, open, onToggle }: { settlement: AdminSettlement; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-4 py-3 font-medium text-belize-navy">{r.orderNumber ?? '—'}</td>
        <td className="px-4 py-3 text-xs text-slate-600">{r.vendor ?? '—'}</td>
        <td className="px-4 py-3 text-right text-slate-600">{money(r.grossMinor, r.currency)}</td>
        <td className="px-4 py-3 text-right text-slate-600">{money(r.commissionMinor, r.currency)}</td>
        <td className="px-4 py-3 text-right text-slate-600">{money(r.driverAllocationMinor, r.currency)}</td>
        <td className="px-4 py-3 text-right text-slate-600">{money(r.platformFeeMinor, r.currency)}</td>
        <td className="px-4 py-3 text-right font-semibold text-belize-navy">{money(r.netMinor, r.currency)}</td>
        <td className="px-4 py-3">
          <StatusBadge status={r.status} />
        </td>
        <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(r.postedAt ?? r.calculatedAt)}</td>
        <td className="px-4 py-3 text-right">
          <button type="button" onClick={onToggle} aria-expanded={open} className="font-semibold text-belize-blue hover:underline">
            {open ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={10} className="px-4 py-4">
            <AdminSettlementDetailView id={r.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function AdminSettlementDetailView({ id }: { id: string }) {
  const [detail, setDetail] = useState<AdminSettlementDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get<AdminSettlementDetail>(`/admin/settlements/${id}`);
        if (active) setDetail(d);
      } catch (e) {
        if (active) setErr(errMessage(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!detail) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  const cur = detail.currency;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-bmpl-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Breakdown</h3>
        <dl className="space-y-1.5 text-sm">
          <DRow label="Merchandise subtotal">{money(detail.merchandiseSubtotalMinor, cur)}</DRow>
          <DRow label="Delivery fee">{money(detail.deliveryFeeMinor, cur)}</DRow>
          <DRow label="Gross" strong>
            {money(detail.grossMinor, cur)}
          </DRow>
          <div className="my-1 border-t border-dashed border-slate-200" />
          <DRow label="− Commission">−{money(detail.commissionMinor, cur)}</DRow>
          <DRow label="− Driver allocation">−{money(detail.driverAllocationMinor, cur)}</DRow>
          <DRow label="− Platform fee">−{money(detail.platformFeeMinor, cur)}</DRow>
          <div className="my-1 border-t border-slate-200" />
          <DRow label="Vendor net" strong>
            {money(detail.netMinor, cur)}
          </DRow>
        </dl>
        {detail.status === 'FAILED' && detail.failureReason && (
          <Alert tone="error" className="mt-3">
            {detail.failureReason}
          </Alert>
        )}
      </div>

      <div className="rounded-bmpl-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Driver earnings</h3>
        {detail.driverEarnings.length === 0 ? (
          <p className="text-sm text-slate-400">No driver earnings for this settlement.</p>
        ) : (
          <ul className="space-y-2">
            {detail.driverEarnings.map((e) => (
              <li key={e.id} className="rounded-bmpl-md border border-slate-100 bg-slate-50 p-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-belize-navy">{money(e.netMinor, e.currency)}</span>
                  <StatusBadge status={e.status} />
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {methodLabel(e.method)} · gross {money(e.grossMinor, e.currency)}
                  {e.adjustmentsMinor !== 0 ? ` · adj ${money(e.adjustmentsMinor, e.currency)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-bmpl-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Rates snapshot</h3>
        {detail.snapshot?.config ? (
          <dl className="space-y-1.5 text-sm">
            {detail.snapshot.config.commissionBps != null && (
              <DRow label="Commission rate">{(detail.snapshot.config.commissionBps / 100).toFixed(2)}%</DRow>
            )}
            {detail.snapshot.config.driverEarningMethod && (
              <DRow label="Driver method">{methodLabel(detail.snapshot.config.driverEarningMethod)}</DRow>
            )}
            {detail.snapshot.config.driverFlatMinor != null && (
              <DRow label="Driver flat">{money(detail.snapshot.config.driverFlatMinor, cur)}</DRow>
            )}
            {detail.snapshot.config.driverDeliveryFeeBps != null && (
              <DRow label="Driver delivery share">{(detail.snapshot.config.driverDeliveryFeeBps / 100).toFixed(2)}%</DRow>
            )}
          </dl>
        ) : (
          <p className="text-sm text-slate-400">No snapshot recorded.</p>
        )}
      </div>
    </div>
  );
}

function DRow({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-600">{label}</dt>
      <dd className={strong ? 'font-semibold text-belize-navy' : 'text-slate-700'}>{children}</dd>
    </div>
  );
}

/* --------------------------------------------------------- exceptions */

function ExceptionsSection({ readOnly, onForbidden }: { readOnly: boolean; onForbidden: () => void }) {
  const [rows, setRows] = useState<Exception[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.get<Exception[]>('/admin/settlements/exceptions'));
    } catch (e) {
      setError(isForbidden(e) ? 'You do not have permission to view exceptions.' : errMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-belize-navy">Failed settlements &amp; exceptions</h2>
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : !rows ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No exceptions" description="There are no failed settlements to review." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Failure reason</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <ExceptionRow key={x.id} exception={x} readOnly={readOnly} onForbidden={onForbidden} onRetried={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ExceptionRow({
  exception: x,
  readOnly,
  onForbidden,
  onRetried,
}: {
  exception: Exception;
  readOnly: boolean;
  onForbidden: () => void;
  onRetried: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: Tone; text: string } | null>(null);

  async function retry() {
    setBusy(true);
    setResult(null);
    try {
      const res = await api.post<{ settled: boolean; reason?: string }>(`/admin/settlements/vendor-order/${x.vendorOrderId}/retry`);
      if (res.settled) {
        setResult({ tone: 'success', text: 'Settled ✓' });
        await onRetried();
      } else {
        setResult({ tone: 'warning', text: res.reason ?? 'Still failing.' });
      }
    } catch (e) {
      if (isForbidden(e)) {
        onForbidden();
        return;
      }
      setResult({ tone: 'error', text: errMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-3 font-medium text-belize-navy">{x.orderNumber ?? '—'}</td>
      <td className="px-4 py-3 text-xs text-slate-600">
        {x.failureReason ?? '—'}
        {result && (
          <Badge tone={result.tone} className="ml-2">
            {result.text}
          </Badge>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(x.updatedAt)}</td>
      <td className="px-4 py-3 text-right">
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={retry} disabled={busy}>
            {busy ? 'Retrying…' : 'Retry'}
          </Button>
        )}
      </td>
    </tr>
  );
}

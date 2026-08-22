'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import {
  Card,
  PageHeader,
  StatusBadge,
  Alert,
  Spinner,
  EmptyState,
  Badge,
} from '../../../components/ui';

/* --------------------------------------------------------------- types */

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

interface SettlementsResponse {
  totals: { pendingMinor: number; postedMinor: number };
  settlements: Settlement[];
}

interface Snapshot {
  config?: { commissionBps?: number; driverEarningMethod?: string; driverFlatMinor?: number; driverDeliveryFeeBps?: number };
  inputs?: { merchandiseSubtotalMinor?: number; deliveryFeeMinor?: number; hasDelivery?: boolean };
  breakdown?: Record<string, number>;
}

type SettlementDetail = Settlement & { snapshot?: Snapshot | null };

/* --------------------------------------------------------------- helpers */

function money(n: number, currency = 'BZD'): string {
  return `${currency === 'USD' ? 'US$' : '$'}${(n / 100).toFixed(2)}`;
}
function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}
function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

/* ----------------------------------------------------------------- page */

export default function VendorSettlementsPage() {
  const [data, setData] = useState<SettlementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get<SettlementsResponse>('/vendor/settlements');
        if (active) setData(d);
      } catch (e) {
        const err = e as ApiError;
        if (!active) return;
        if (err.status === 403) setForbidden(true);
        else setError(errMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Vendor"
        title="Earnings & Settlements"
        description="A transparent breakdown of how each delivered order settles into your wallet. Balances are read-only."
      />

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}

      {!loading && forbidden && (
        <Alert tone="warning" title="Vendor access required">
          Earnings &amp; settlements are only available to approved vendor accounts.
        </Alert>
      )}

      {!loading && error && !forbidden && <Alert tone="error">{error}</Alert>}

      {!loading && !forbidden && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TotalCard label="Pending settlement" value={money(data.totals.pendingMinor)} tone="warning" hint="Calculated, not yet posted to your wallet." />
            <TotalCard label="Posted to wallet" value={money(data.totals.postedMinor)} tone="success" hint="Net earnings credited to your wallet." />
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-belize-navy">Settlement history</h2>
              <p className="text-xs text-slate-500">Expand a row to see the full calculation for that order.</p>
            </div>
            {data.settlements.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No settlements yet" description="Settlements appear here once your delivered orders are settled." />
              </div>
            ) : (
              <SettlementsTable settlements={data.settlements} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function TotalCard({ label, value, tone, hint }: { label: string; value: string; tone: 'warning' | 'success'; hint: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <Badge tone={tone}>{tone === 'success' ? 'Posted' : 'Pending'}</Badge>
      </div>
      <p className="mt-1.5 text-3xl font-bold text-belize-navy">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </Card>
  );
}

/* ---------------------------------------------------------------- table */

function SettlementsTable({ settlements }: { settlements: Settlement[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Order</th>
            <th className="px-4 py-3 text-right">Gross</th>
            <th className="px-4 py-3 text-right">Commission</th>
            <th className="px-4 py-3 text-right">Delivery fee</th>
            <th className="px-4 py-3 text-right">Driver</th>
            <th className="px-4 py-3 text-right">Platform fee</th>
            <th className="px-4 py-3 text-right">Net</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {settlements.map((s) => {
            const open = openId === s.id;
            return (
              <RowGroup key={s.id} settlement={s} open={open} onToggle={() => setOpenId(open ? null : s.id)} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowGroup({ settlement: s, open, onToggle }: { settlement: Settlement; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-4 py-3 font-medium text-belize-navy">{s.orderNumber ?? '—'}</td>
        <td className="px-4 py-3 text-right text-slate-600">{money(s.grossMinor, s.currency)}</td>
        <td className="px-4 py-3 text-right text-slate-600">−{money(s.commissionMinor, s.currency)}</td>
        <td className="px-4 py-3 text-right text-slate-600">{money(s.deliveryFeeMinor, s.currency)}</td>
        <td className="px-4 py-3 text-right text-slate-600">−{money(s.driverAllocationMinor, s.currency)}</td>
        <td className="px-4 py-3 text-right text-slate-600">−{money(s.platformFeeMinor, s.currency)}</td>
        <td className="px-4 py-3 text-right font-semibold text-belize-navy">{money(s.netMinor, s.currency)}</td>
        <td className="px-4 py-3">
          <StatusBadge status={s.status} />
        </td>
        <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(s.postedAt ?? s.calculatedAt)}</td>
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="font-semibold text-belize-blue hover:underline"
          >
            {open ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={10} className="px-4 py-4">
            <ExpandedDetail settlement={s} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedDetail({ settlement: s }: { settlement: Settlement }) {
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get<SettlementDetail>(`/vendor/settlements/${s.id}`);
        if (active) setDetail(d);
      } catch (e) {
        if (active) setErr(errMessage(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [s.id]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-bmpl-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Calculation breakdown</h3>
        <dl className="space-y-1.5 text-sm">
          <BreakdownRow label="Merchandise subtotal">{money(s.merchandiseSubtotalMinor, s.currency)}</BreakdownRow>
          <BreakdownRow label="Delivery fee">{money(s.deliveryFeeMinor, s.currency)}</BreakdownRow>
          <BreakdownRow label="Gross" strong>
            {money(s.grossMinor, s.currency)}
          </BreakdownRow>
          <div className="my-1 border-t border-dashed border-slate-200" />
          <BreakdownRow label="− Platform commission" tone="muted">
            −{money(s.commissionMinor, s.currency)}
          </BreakdownRow>
          <BreakdownRow label="− Driver allocation" tone="muted">
            −{money(s.driverAllocationMinor, s.currency)}
          </BreakdownRow>
          <BreakdownRow label="− Platform fee" tone="muted">
            −{money(s.platformFeeMinor, s.currency)}
          </BreakdownRow>
          <div className="my-1 border-t border-slate-200" />
          <BreakdownRow label="Your net payout" strong>
            {money(s.netMinor, s.currency)}
          </BreakdownRow>
        </dl>
        {s.status === 'FAILED' && s.failureReason && (
          <Alert tone="error" className="mt-3">
            {s.failureReason}
          </Alert>
        )}
      </div>

      <div className="rounded-bmpl-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Rates applied</h3>
        {err ? (
          <p className="text-sm text-red-600">{err}</p>
        ) : !detail ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        ) : detail.snapshot?.config ? (
          <dl className="space-y-1.5 text-sm">
            {detail.snapshot.config.commissionBps != null && (
              <BreakdownRow label="Commission rate">{(detail.snapshot.config.commissionBps / 100).toFixed(2)}%</BreakdownRow>
            )}
            {detail.snapshot.config.driverEarningMethod && (
              <BreakdownRow label="Driver earning method">{methodLabel(detail.snapshot.config.driverEarningMethod)}</BreakdownRow>
            )}
            {detail.snapshot.config.driverDeliveryFeeBps != null && (
              <BreakdownRow label="Driver delivery share">{(detail.snapshot.config.driverDeliveryFeeBps / 100).toFixed(2)}%</BreakdownRow>
            )}
            <p className="pt-2 text-xs text-slate-400">
              Commission and driver-share rates are configurable platform fee rates set by BML.
            </p>
          </dl>
        ) : (
          <p className="text-sm text-slate-400">No rate snapshot available for this settlement.</p>
        )}
      </div>
    </div>
  );
}

function BreakdownRow({ label, children, strong, tone }: { label: string; children: React.ReactNode; strong?: boolean; tone?: 'muted' }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={tone === 'muted' ? 'text-slate-500' : 'text-slate-600'}>{label}</dt>
      <dd className={strong ? 'font-semibold text-belize-navy' : 'text-slate-700'}>{children}</dd>
    </div>
  );
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

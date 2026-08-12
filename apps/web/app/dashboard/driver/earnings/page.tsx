'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../../../../lib/api';
import { DriverBreadcrumb } from '../../../../components/driver/DriverBreadcrumb';
import {
  Card,
  PageHeader,
  StatusBadge,
  Alert,
  Spinner,
  EmptyState,
  Badge,
} from '../../../../components/ui';

/* --------------------------------------------------------------- types */

interface Earning {
  id: string;
  orderDeliveryId: string;
  vendorOrderId: string;
  currency: string;
  method: string;
  grossMinor: number;
  adjustmentsMinor: number;
  netMinor: number;
  status: 'PENDING' | 'POSTED' | 'FAILED';
  calculatedAt: string;
  postedAt: string | null;
}

interface EarningsResponse {
  totals: { pendingMinor: number; postedMinor: number; completedDeliveries: number };
  earnings: Earning[];
}

interface Snapshot {
  deliveryFeeMinor?: number;
  method?: string;
  driverDeliveryFeeBps?: number;
  driverFlatMinor?: number;
}

type EarningDetail = Earning & { snapshot?: Snapshot | null };

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

/* ----------------------------------------------------------------- page */

export default function DriverEarningsPage() {
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get<EarningsResponse>('/driver/earnings');
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
    <div className="mx-auto max-w-4xl space-y-6">
      <DriverBreadcrumb current="My Earnings" />

      <PageHeader
        title="My Earnings"
        description="Your delivery earnings and how each one was calculated. Balances are read-only."
      />

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}

      {!loading && forbidden && (
        <Alert tone="warning" title="Driver access required">
          Earnings are only available to approved delivery-driver accounts.
        </Alert>
      )}

      {!loading && error && !forbidden && <Alert tone="error">{error}</Alert>}

      {!loading && !forbidden && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <TotalCard label="Completed deliveries" value={String(data.totals.completedDeliveries)} tone="brand" />
            <TotalCard label="Pending" value={money(data.totals.pendingMinor)} tone="warning" />
            <TotalCard label="Posted to wallet" value={money(data.totals.postedMinor)} tone="success" />
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-belize-navy">Earnings history</h2>
              <p className="text-xs text-slate-500">Expand a row to see how the earning was calculated.</p>
            </div>
            {data.earnings.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No earnings yet" description="Earnings appear here once your completed deliveries are settled." />
              </div>
            ) : (
              <EarningsTable earnings={data.earnings} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function TotalCard({ label, value, tone }: { label: string; value: string; tone: 'brand' | 'warning' | 'success' }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <Badge tone={tone}>{tone === 'brand' ? 'Total' : tone === 'success' ? 'Posted' : 'Pending'}</Badge>
      </div>
      <p className="mt-1.5 text-3xl font-bold text-belize-navy">{value}</p>
    </Card>
  );
}

/* ---------------------------------------------------------------- table */

function EarningsTable({ earnings }: { earnings: Earning[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Order</th>
            <th className="px-4 py-3">Method</th>
            <th className="px-4 py-3 text-right">Gross</th>
            <th className="px-4 py-3 text-right">Net</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {earnings.map((e) => {
            const open = openId === e.id;
            return <RowGroup key={e.id} earning={e} open={open} onToggle={() => setOpenId(open ? null : e.id)} />;
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowGroup({ earning: e, open, onToggle }: { earning: Earning; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-4 py-3 font-mono text-xs text-belize-navy">#{e.vendorOrderId.slice(0, 8)}</td>
        <td className="px-4 py-3 text-slate-600">{methodLabel(e.method)}</td>
        <td className="px-4 py-3 text-right text-slate-600">{money(e.grossMinor, e.currency)}</td>
        <td className="px-4 py-3 text-right font-semibold text-belize-navy">{money(e.netMinor, e.currency)}</td>
        <td className="px-4 py-3">
          <StatusBadge status={e.status} />
        </td>
        <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(e.postedAt ?? e.calculatedAt)}</td>
        <td className="px-4 py-3 text-right">
          <button type="button" onClick={onToggle} aria-expanded={open} className="font-semibold text-belize-blue hover:underline">
            {open ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={7} className="px-4 py-4">
            <ExpandedDetail earning={e} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedDetail({ earning: e }: { earning: Earning }) {
  const [detail, setDetail] = useState<EarningDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get<EarningDetail>(`/driver/earnings/${e.id}`);
        if (active) setDetail(d);
      } catch (ex) {
        if (active) setErr(errMessage(ex));
      }
    })();
    return () => {
      active = false;
    };
  }, [e.id]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-bmpl-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Calculation breakdown</h3>
        <dl className="space-y-1.5 text-sm">
          <Row label="Earning method">{methodLabel(e.method)}</Row>
          <Row label="Gross earning">{money(e.grossMinor, e.currency)}</Row>
          <Row label="Adjustments">{e.adjustmentsMinor === 0 ? money(0, e.currency) : `${e.adjustmentsMinor > 0 ? '+' : '−'}${money(Math.abs(e.adjustmentsMinor), e.currency)}`}</Row>
          <div className="my-1 border-t border-slate-200" />
          <Row label="Net earning" strong>
            {money(e.netMinor, e.currency)}
          </Row>
        </dl>
      </div>

      <div className="rounded-bmpl-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Rates applied</h3>
        {err ? (
          <p className="text-sm text-red-600">{err}</p>
        ) : !detail ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        ) : detail.snapshot ? (
          <dl className="space-y-1.5 text-sm">
            {detail.snapshot.deliveryFeeMinor != null && (
              <Row label="Order delivery fee">{money(detail.snapshot.deliveryFeeMinor, e.currency)}</Row>
            )}
            {detail.snapshot.driverDeliveryFeeBps != null && (
              <Row label="Driver delivery share">{(detail.snapshot.driverDeliveryFeeBps / 100).toFixed(2)}%</Row>
            )}
            {detail.snapshot.driverFlatMinor != null && (
              <Row label="Flat component">{money(detail.snapshot.driverFlatMinor, e.currency)}</Row>
            )}
            <p className="pt-2 text-xs text-slate-400">
              Driver-earning rates are configurable platform fee rates set by BMPL.
            </p>
          </dl>
        ) : (
          <p className="text-sm text-slate-400">No rate snapshot available for this earning.</p>
        )}
      </div>
    </div>
  );
}

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-600">{label}</dt>
      <dd className={strong ? 'font-semibold text-belize-navy' : 'text-slate-700'}>{children}</dd>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { Alert, Badge, Card, EmptyState, PageHeader, Select, Spinner } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

/* --------------------------------------------------------------- types */

interface Overview {
  gmvMinor: number;
  paidOrders: number;
  totalOrders: number;
  cancelledOrders: number;
  aovMinor: number;
  unitsSold: number;
  platformRevenueMinor: number;
  vendorNetMinor: number;
  settledGrossMinor: number;
  approvedVendors: number;
  approvedDrivers: number;
  totalCustomers: number;
  publishedProducts: number;
  reviewCount: number;
  avgRating: number;
}

interface SalesPoint {
  date: string;
  orders: number;
  grossMinor: number;
}

interface SalesResponse {
  days: number;
  series: SalesPoint[];
}

interface TopProduct {
  productId: string;
  title: string;
  unitsSold: number;
  revenueMinor: number;
}

interface TopVendor {
  vendorProfileId: string;
  businessName: string;
  orders: number;
  revenueMinor: number;
}

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/* --------------------------------------------------------------- helpers */

const money = (c: number) => '$' + (c / 100).toFixed(2);
const int = (n: number) => n.toLocaleString('en-US');

function apiStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null ? (err as ApiError).status : undefined;
}

function fmtDay(iso: string): string {
  // iso is YYYY-MM-DD — render as a short "Aug 1" label without timezone drift.
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const RANGES: Array<{ value: number; label: string }> = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

/* ----------------------------------------------------------------- page */

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [topVendors, setTopVendors] = useState<TopVendor[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let active = true;
    (async () => {
      setState('loading');
      try {
        const [ov, tp, tv] = await Promise.all([
          api.get<Overview>('/admin/analytics/overview'),
          api.get<TopProduct[]>('/admin/analytics/top-products?limit=10'),
          api.get<TopVendor[]>('/admin/analytics/top-vendors?limit=10'),
        ]);
        if (!active) return;
        setOverview(ov);
        setTopProducts(tp);
        setTopVendors(tv);
        setState('ready');
      } catch (err) {
        if (!active) return;
        setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={adminCrumbs('Analytics')}
        eyebrow="Insights"
        title="Platform analytics"
        description="Marketplace performance at a glance — sales, top sellers and platform totals."
        actions={
          <a
            href="/api/admin/analytics/reports/orders.csv"
            download="orders.csv"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-belize-navy shadow-bmpl-sm transition hover:border-belize-blue hover:bg-belize-blue/5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
            </svg>
            Download orders CSV
          </a>
        }
      />

      {state === 'forbidden' ? (
        <Alert tone="warning" title="Access restricted">
          You don&apos;t have the <code>analytics.read</code> permission.
        </Alert>
      ) : state === 'loading' ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading analytics…
        </div>
      ) : state === 'error' || !overview ? (
        <Alert tone="error">We couldn&apos;t load analytics right now. Please try again shortly.</Alert>
      ) : (
        <>
          <KpiGrid o={overview} />
          <SalesSection />
          <div className="grid gap-6 lg:grid-cols-2">
            <TopProductsTable rows={topProducts} />
            <TopVendorsTable rows={topVendors} />
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- KPI cards */

function KpiGrid({ o }: { o: Overview }) {
  const cards: Array<{ label: string; value: string; sub?: string }> = [
    { label: 'GMV', value: money(o.gmvMinor), sub: `${int(o.totalOrders)} orders total` },
    { label: 'Platform revenue', value: money(o.platformRevenueMinor) },
    { label: 'Paid orders', value: int(o.paidOrders), sub: o.cancelledOrders ? `${int(o.cancelledOrders)} cancelled` : undefined },
    { label: 'Avg order value', value: money(o.aovMinor) },
    { label: 'Units sold', value: int(o.unitsSold) },
    { label: 'Approved vendors', value: int(o.approvedVendors) },
    { label: 'Approved drivers', value: int(o.approvedDrivers) },
    { label: 'Total customers', value: int(o.totalCustomers) },
    { label: 'Published products', value: int(o.publishedProducts) },
    {
      label: 'Avg rating',
      value: o.reviewCount ? o.avgRating.toFixed(2) : '—',
      sub: `${int(o.reviewCount)} review${o.reviewCount === 1 ? '' : 's'}`,
    },
  ];

  return (
    <section aria-label="Key metrics">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="mt-1.5 text-2xl font-bold text-belize-navy">{c.value}</p>
            {c.sub && <p className="mt-1 text-xs text-slate-400">{c.sub}</p>}
          </Card>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- sales chart */

function SalesSection() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<SalesResponse | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async (range: number) => {
    setState('loading');
    try {
      const d = await api.get<SalesResponse>(`/admin/analytics/sales?days=${range}`);
      setData(d);
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  return (
    <section aria-label="Daily sales">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-belize-navy">Daily sales</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="sales-range" className="text-xs font-medium text-slate-500">
            Range
          </label>
          <Select
            id="sales-range"
            className="w-auto py-1.5 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="p-5">
        {state === 'loading' ? (
          <div className="flex h-56 items-center justify-center gap-2 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading sales…
          </div>
        ) : state === 'forbidden' ? (
          <Alert tone="warning">
            You don&apos;t have the <code>analytics.read</code> permission.
          </Alert>
        ) : state === 'error' || !data ? (
          <Alert tone="error">Could not load sales data.</Alert>
        ) : data.series.length === 0 ? (
          <EmptyState title="No sales data" description="There is no order activity for this period yet." />
        ) : (
          <BarChart series={data.series} />
        )}
      </Card>
    </section>
  );
}

function BarChart({ series }: { series: SalesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const maxGross = useMemo(() => Math.max(...series.map((p) => p.grossMinor), 0), [series]);
  const maxOrders = useMemo(() => Math.max(...series.map((p) => p.orders), 0), [series]);
  const totalGross = useMemo(() => series.reduce((s, p) => s + p.grossMinor, 0), [series]);
  const totalOrders = useMemo(() => series.reduce((s, p) => s + p.orders, 0), [series]);
  const allZero = maxGross === 0;

  // Label a handful of evenly-spaced dates so the axis never crowds.
  const labelEvery = Math.max(1, Math.ceil(series.length / 8));

  const first = series[0];
  const last = series[series.length - 1];
  const summary =
    allZero || !first || !last
      ? `No sales in this period across ${series.length} days.`
      : `Daily gross sales from ${fmtDay(first.date)} to ${fmtDay(last.date)}. ` +
        `Total ${money(totalGross)} across ${int(totalOrders)} orders. Peak day ${money(maxGross)}.`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-500">
        <span>
          Total gross <span className="font-semibold text-belize-navy">{money(totalGross)}</span>
        </span>
        <span>
          Orders <span className="font-semibold text-belize-navy">{int(totalOrders)}</span>
        </span>
      </div>

      {allZero && (
        <p className="mb-3 text-sm font-medium text-slate-400">No sales in this period.</p>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[32rem]" role="img" aria-label={summary}>
          {/* Gross revenue bars */}
          <div className="flex h-56 items-end gap-[2px]" aria-hidden>
            {series.map((p, i) => {
              const pct = maxGross > 0 ? (p.grossMinor / maxGross) * 100 : 0;
              const active = hover === i;
              return (
                <div
                  key={p.date}
                  className="relative flex h-full flex-1 items-end"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                >
                  {/* baseline track keeps a visible flat line even at zero */}
                  <div className="absolute inset-x-0 bottom-0 h-px bg-slate-200" />
                  <div
                    className={`w-full rounded-t-[3px] transition-colors ${active ? 'bg-belize-deep' : 'bg-belize-blue'}`}
                    style={{ height: `${Math.max(pct, allZero ? 0 : 1.5)}%`, minHeight: p.grossMinor > 0 ? 2 : 0 }}
                  />
                  {active && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-bmpl-md bg-belize-navy px-2.5 py-1.5 text-xs text-white shadow-bmpl-md">
                      <div className="font-semibold">{fmtDay(p.date)}</div>
                      <div>{money(p.grossMinor)}</div>
                      <div className="text-blue-100/80">
                        {int(p.orders)} order{p.orders === 1 ? '' : 's'}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Orders strip — its own scale (separate chart, not a dual axis) */}
          <div className="mt-3 flex h-10 items-end gap-[2px]" aria-hidden>
            {series.map((p, i) => {
              const pct = maxOrders > 0 ? (p.orders / maxOrders) * 100 : 0;
              const active = hover === i;
              return (
                <div
                  key={p.date}
                  className="flex h-full flex-1 items-end"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                >
                  <div
                    className={`w-full rounded-t-[2px] transition-colors ${active ? 'bg-belize-navy' : 'bg-belize-blue/30'}`}
                    style={{ height: `${pct}%`, minHeight: p.orders > 0 ? 2 : 0 }}
                  />
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Orders per day</p>

          {/* Date axis */}
          <div className="mt-2 flex gap-[2px]" aria-hidden>
            {series.map((p, i) => (
              <div key={p.date} className="flex-1 overflow-hidden text-center text-[10px] text-slate-400">
                {i % labelEvery === 0 ? fmtDay(p.date) : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- top products */

function TopProductsTable({ rows }: { rows: TopProduct[] }) {
  return (
    <section aria-label="Top products">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-belize-navy">Top products</h2>
        <Badge tone="brand">By revenue</Badge>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No product sales yet" description="Best-selling products will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Units sold</th>
                <th className="px-4 py-3 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-belize-navy">{r.title}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{int(r.unitsSold)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-belize-navy">{money(r.revenueMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- top vendors */

function TopVendorsTable({ rows }: { rows: TopVendor[] }) {
  return (
    <section aria-label="Top vendors">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-belize-navy">Top vendors</h2>
        <Badge tone="brand">By revenue</Badge>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No vendor sales yet" description="Best-performing vendors will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3 text-right">Orders</th>
                <th className="px-4 py-3 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.vendorProfileId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-belize-navy">{r.businessName}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{int(r.orders)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-belize-navy">{money(r.revenueMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

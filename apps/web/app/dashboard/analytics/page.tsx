'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { money } from '../../../lib/cart';
import {
  Alert,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
} from '../../../components/ui';

/* --------------------------------------------------------------- types */

interface Overview {
  paidOrders: number;
  grossSalesMinor: number;
  unitsSold: number;
  netRevenueMinor: number;
  commissionPaidMinor: number;
  settledGrossMinor: number;
  pendingSettlements: number;
  publishedProducts: number;
  ratingAverage: number;
  ratingCount: number;
}

interface SalesPoint {
  date: string; // YYYY-MM-DD
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

/* --------------------------------------------------------------- helpers */

function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}
function intFmt(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n ?? 0));
}
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const RANGE_OPTIONS = [7, 30, 90] as const;
type Range = (typeof RANGE_OPTIONS)[number];

/* ----------------------------------------------------------------- page */

export default function VendorAnalyticsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get<Overview>('/vendor/analytics/overview');
        if (active) setOverview(d);
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
        title="Analytics"
        description="Sales performance for your store — paid orders, revenue after commission, and your best sellers."
        actions={
          !forbidden && !loading ? (
            <a
              href="/api/vendor/analytics/reports/orders.csv"
              download
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-belize-navy shadow-bmpl-sm transition hover:border-belize-blue hover:bg-belize-blue/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              Download my orders CSV
            </a>
          ) : undefined
        }
      />

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      )}

      {!loading && forbidden && (
        <Alert tone="warning" title="Vendor access required">
          Analytics are only available to approved vendor accounts. Want to sell on BMPL?{' '}
          <a href="/sell" className="font-semibold text-belize-blue hover:underline">
            Become a vendor
          </a>
          .
        </Alert>
      )}

      {!loading && error && !forbidden && <Alert tone="error">{error}</Alert>}

      {!loading && !forbidden && overview && (
        <>
          <KpiGrid o={overview} />
          <SalesSection />
          <TopProductsSection />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- KPIs */

function KpiGrid({ o }: { o: Overview }) {
  const rating =
    o.ratingCount > 0
      ? `${o.ratingAverage.toFixed(1)} ★`
      : 'No ratings';
  const ratingHint = o.ratingCount > 0 ? `${intFmt(o.ratingCount)} review${o.ratingCount === 1 ? '' : 's'}` : 'Not rated yet';

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      <KpiCard label="Gross sales" value={money(o.grossSalesMinor)} hint="From paid orders" />
      <KpiCard label="Net revenue" value={money(o.netRevenueMinor)} hint="After commission" accent />
      <KpiCard label="Commission paid" value={money(o.commissionPaidMinor)} hint="Platform fees" />
      <KpiCard label="Paid orders" value={intFmt(o.paidOrders)} hint="Orders you were paid for" />
      <KpiCard label="Units sold" value={intFmt(o.unitsSold)} hint="Items across paid orders" />
      <KpiCard label="Pending settlements" value={intFmt(o.pendingSettlements)} hint="Awaiting payout" />
      <KpiCard label="Published products" value={intFmt(o.publishedProducts)} hint="Live listings" />
      <KpiCard label="Rating" value={rating} hint={ratingHint} />
    </div>
  );
}

function KpiCard({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold sm:text-3xl ${accent ? 'text-belize-blue' : 'text-belize-navy'}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </Card>
  );
}

/* ------------------------------------------------------------------- sales */

function SalesSection() {
  const [range, setRange] = useState<Range>(30);
  const [data, setData] = useState<SalesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const d = await api.get<SalesResponse>(`/vendor/analytics/sales?days=${range}`);
        if (active) setData(d);
      } catch (e) {
        if (active) setError(errMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [range]);

  const series = data?.series ?? [];
  const totalGross = series.reduce((s, p) => s + p.grossMinor, 0);
  const totalOrders = series.reduce((s, p) => s + p.orders, 0);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-belize-navy">Daily sales</h2>
          <p className="text-xs text-slate-500">
            Gross sales per day{series.length > 0 ? ` — ${money(totalGross)} across ${intFmt(totalOrders)} order${totalOrders === 1 ? '' : 's'}` : ''}.
          </p>
        </div>
        <div>
          <label htmlFor="range" className="sr-only">
            Date range
          </label>
          <Select id="range" className="w-auto" value={range} onChange={(e) => setRange(Number(e.target.value) as Range)}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
        </div>
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="flex h-48 items-center justify-center gap-2 text-sm text-slate-500">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        ) : error ? (
          <Alert tone="error">{error}</Alert>
        ) : (
          <BarChart series={series} />
        )}
      </div>
    </Card>
  );
}

function BarChart({ series }: { series: SalesPoint[] }) {
  const max = series.reduce((m, p) => Math.max(m, p.grossMinor), 0);

  if (series.length === 0 || max === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-bmpl-lg border border-dashed border-slate-200 bg-slate-50/60 text-sm text-slate-500">
        No sales in this period.
      </div>
    );
  }

  // Label a handful of x positions so they never collide.
  const step = Math.max(1, Math.ceil(series.length / 6));

  return (
    <figure
      role="img"
      aria-label={`Bar chart of daily gross sales over ${series.length} days. Peak day ${money(max)}.`}
      className="overflow-x-auto"
    >
      <div className="min-w-[320px]">
        <div className="flex h-48 items-end gap-[2px]" aria-hidden>
          {series.map((p) => {
            const pct = Math.max(p.grossMinor > 0 ? 4 : 0, (p.grossMinor / max) * 100);
            return (
              <div key={p.date} className="group relative flex flex-1 items-end justify-center" style={{ height: '100%' }}>
                <div
                  className="w-full rounded-t bg-belize-blue/85 transition group-hover:bg-belize-blue"
                  style={{ height: `${pct}%` }}
                  title={`${shortDate(p.date)}: ${money(p.grossMinor)} · ${intFmt(p.orders)} order${p.orders === 1 ? '' : 's'}`}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-bmpl-md bg-belize-navy px-2 py-1 text-[11px] font-medium text-white shadow-bmpl-md group-hover:block">
                  <span className="block font-semibold">{shortDate(p.date)}</span>
                  {money(p.grossMinor)} · {intFmt(p.orders)} order{p.orders === 1 ? '' : 's'}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-[2px] border-t border-slate-100 pt-1.5">
          {series.map((p, i) => (
            <div key={p.date} className="flex-1 text-center text-[10px] text-slate-400">
              {i % step === 0 ? shortDate(p.date) : ''}
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------ top products */

function TopProductsSection() {
  const [items, setItems] = useState<TopProduct[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get<TopProduct[]>('/vendor/analytics/top-products?limit=10');
        if (active) setItems(d);
      } catch (e) {
        if (active) setError(errMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-belize-navy">Top products</h2>
        <p className="text-xs text-slate-500">Your best sellers by units sold.</p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 p-5 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : error ? (
        <div className="p-5">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : !items || items.length === 0 ? (
        <div className="p-5">
          <EmptyState title="No sales yet" description="Your best-selling products will appear here once you start making sales." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Units sold</th>
                <th className="px-4 py-3 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.productId} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-belize-navy">{p.title}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{intFmt(p.unitsSold)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-belize-navy">{money(p.revenueMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

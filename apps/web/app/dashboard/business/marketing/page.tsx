'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { type ApiError } from '../../../../lib/api';
import { marketingApi, type OwnerAnalytics } from '../../../../lib/marketing';
import { BusinessMarketingGate } from '../../../../components/marketing/BusinessMarketingGate';
import { StatGrid, EngagementTotals, ByStatus, TopPromotions } from '../../../../components/marketing/AnalyticsPanel';
import { Alert, Card, PageHeader, Spinner } from '../../../../components/ui';

const QUICK_LINKS = [
  { href: '/dashboard/business/marketing/promotions', title: 'Promotions', desc: 'Create and manage featured placements & banners.' },
  { href: '/dashboard/business/marketing/campaigns', title: 'Campaigns', desc: 'Group promotions under a scheduled campaign.' },
  { href: '/dashboard/business/marketing/coupons', title: 'Coupons', desc: 'Offer discounts on your store (vendors).' },
];

export default function MarketingOverviewPage() {
  const [data, setData] = useState<OwnerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await marketingApi.analytics());
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setForbidden(true);
      else setError(err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (forbidden) return <BusinessMarketingGate />;
  if (error || !data) return <Alert tone="error">{error ?? 'Failed to load.'}</Alert>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Marketing overview"
        description="Promote your business across BMPL and track how your promotions perform."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {QUICK_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="group rounded-bmpl-lg border border-slate-200 bg-white p-5 shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:shadow-bmpl-md"
          >
            <p className="font-semibold text-belize-navy group-hover:text-belize-blue">{l.title}</p>
            <p className="mt-1 text-sm text-slate-500">{l.desc}</p>
          </Link>
        ))}
      </div>

      <StatGrid
        stats={[
          { label: 'Total promotions', value: data.totalPromotions },
          { label: 'Serving now', value: data.activePromotions },
          { label: 'Campaigns', value: data.campaigns },
          { label: 'Coupons', value: data.coupons },
        ]}
      />
      <EngagementTotals totals={data.totals} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ByStatus byStatus={data.byStatus} />
        <Card className="p-5">
          <h2 className="bmpl-eyebrow mb-3">Tips</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
            <li>Promotions are reviewed by our team before they go live.</li>
            <li>Only content you own can be targeted — ownership is verified automatically.</li>
            <li>Add clear banner creative for the best placement performance.</li>
          </ul>
        </Card>
      </div>
      <TopPromotions items={data.topPromotions} />
    </div>
  );
}

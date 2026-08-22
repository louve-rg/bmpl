'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { type ApiError } from '../../../../../lib/api';
import {
  marketingApi,
  promotionTypeLabel,
  formatPromoWindow,
  fmtDate,
  type OwnerPromotionCard,
} from '../../../../../lib/marketing';
import { BusinessMarketingGate } from '../../../../../components/marketing/BusinessMarketingGate';
import { StatusBadge } from '../../../../../components/marketing/StatusBadge';
import { Alert, ButtonLink, Card, EmptyState, PageHeader, Spinner } from '../../../../../components/ui';

export default function PromotionsListPage() {
  const [items, setItems] = useState<OwnerPromotionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await marketingApi.promotions());
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="My promotions"
        description="Featured placements and banners you've created."
        actions={<ButtonLink href="/dashboard/business/marketing/promotions/new">New promotion</ButtonLink>}
      />
      {error && <Alert tone="error">{error}</Alert>}

      {items.length === 0 ? (
        <EmptyState
          title="No promotions yet"
          description="Create a promotion to feature your store, products, jobs, or listings across BML."
          action={<ButtonLink href="/dashboard/business/marketing/promotions/new">New promotion</ButtonLink>}
        />
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <Link key={p.id} href={`/dashboard/business/marketing/promotions/${p.id}`} className="block">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-belize-light/60 hover:shadow-bmpl-md">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-belize-navy">{p.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {promotionTypeLabel(p.type)} · {formatPromoWindow(p.startAt, p.endAt)} · Updated {fmtDate(p.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {p.isActive && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> Serving
                    </span>
                  )}
                  <StatusBadge status={p.status} kind="promotion" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

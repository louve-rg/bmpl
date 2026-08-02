'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ApiError } from '../../../../../lib/api';
import { marketingApi, campaignTypeLabel, fmtDate, type CampaignCard } from '../../../../../lib/marketing';
import { BusinessMarketingGate } from '../../../../../components/marketing/BusinessMarketingGate';
import { StatusBadge } from '../../../../../components/marketing/StatusBadge';
import { CampaignForm } from '../../../../../components/marketing/CampaignForm';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner } from '../../../../../components/ui';

export default function CampaignsListPage() {
  const router = useRouter();
  const [items, setItems] = useState<CampaignCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await marketingApi.campaigns());
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
        title="Campaigns"
        description="Group promotions under a scheduled campaign. Only a running campaign lets its promotions serve."
        actions={
          <Button variant={creating ? 'ghost' : 'primary'} onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : 'New campaign'}
          </Button>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}

      {creating && (
        <Card className="p-5">
          <h2 className="bmpl-eyebrow mb-4">New campaign</h2>
          <CampaignForm
            submitting={submitting}
            submitLabel="Create campaign"
            onSubmit={async (values) => {
              setError(null);
              setSubmitting(true);
              try {
                const c = await marketingApi.createCampaign(values);
                router.push(`/dashboard/business/marketing/campaigns/${c.id}`);
              } catch (e) {
                setError((e as ApiError).message ?? 'Could not create the campaign.');
                setSubmitting(false);
              }
            }}
          />
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Create a campaign to organize and schedule your promotions." />
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <Link key={c.id} href={`/dashboard/business/marketing/campaigns/${c.id}`} className="block">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-belize-light/60 hover:shadow-bmpl-md">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-belize-navy">{c.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {campaignTypeLabel(c.type)} · {c.promotionCount} promotions · {c.couponCount} coupons · Updated {fmtDate(c.updatedAt)}
                  </p>
                </div>
                <StatusBadge status={c.status} kind="campaign" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

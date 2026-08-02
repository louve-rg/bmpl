'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CAMPAIGN_TRANSITIONS, CAMPAIGN_STATUS_LABELS, type CampaignStatus } from '@bmpl/shared';
import { type ApiError } from '../../../../../../lib/api';
import { marketingApi, promotionTypeLabel, type CampaignDetail } from '../../../../../../lib/marketing';
import { BusinessMarketingGate } from '../../../../../../components/marketing/BusinessMarketingGate';
import { StatusBadge } from '../../../../../../components/marketing/StatusBadge';
import { CampaignForm } from '../../../../../../components/marketing/CampaignForm';
import { ScheduleManager } from '../../../../../../components/marketing/ScheduleManager';
import { Alert, Button, ButtonLink, Card, PageHeader, Spinner } from '../../../../../../components/ui';

export default function CampaignManagePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await marketingApi.campaign(id));
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setForbidden(true);
      else if (err.status === 404) setNotFound(true);
      else setError(err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<CampaignDetail>) {
    setError(null);
    setBusy(true);
    try {
      setDetail(await fn());
    } catch (e) {
      setError((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (forbidden) return <BusinessMarketingGate />;
  if (notFound || !detail) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert tone="error" title="Campaign not found">
          This campaign doesn&apos;t exist or you don&apos;t have access to it.
        </Alert>
        <div className="mt-4">
          <ButtonLink href="/dashboard/business/marketing/campaigns" variant="outline">
            Back to campaigns
          </ButtonLink>
        </div>
      </div>
    );
  }

  const nextStatuses = (CAMPAIGN_TRANSITIONS[detail.status] ?? []) as CampaignStatus[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title={detail.name}
        description={`${detail.promotionCount} promotions · ${detail.couponCount} coupons`}
        actions={<StatusBadge status={detail.status} kind="campaign" />}
      />
      {error && <Alert tone="error">{error}</Alert>}

      {/* status transitions */}
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm text-slate-500">Move to:</span>
        {nextStatuses.length === 0 ? (
          <span className="text-sm text-slate-400">No further transitions.</span>
        ) : (
          nextStatuses.map((s) => (
            <Button
              key={s}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run(() => marketingApi.setCampaignStatus(id, s))}
            >
              {CAMPAIGN_STATUS_LABELS[s]}
            </Button>
          ))
        )}
        <ButtonLink href="/dashboard/business/marketing/campaigns" variant="ghost">
          Back
        </ButtonLink>
      </Card>

      {/* details */}
      <Card className="p-5">
        <h2 className="bmpl-eyebrow mb-4">Details</h2>
        <CampaignForm
          key={detail.updatedAt}
          initial={detail}
          submitting={busy}
          submitLabel="Save details"
          onSubmit={(values) => run(() => marketingApi.updateCampaign(id, values))}
        />
      </Card>

      {/* schedules */}
      <ScheduleManager campaign={detail} onChanged={setDetail} />

      {/* promotions in campaign */}
      <Card className="p-5">
        <h2 className="bmpl-eyebrow mb-3">Promotions in this campaign</h2>
        {detail.promotions.length === 0 ? (
          <p className="text-sm text-slate-400">No promotions linked yet. Assign a campaign when editing a promotion.</p>
        ) : (
          <ul className="space-y-2">
            {detail.promotions.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/dashboard/business/marketing/promotions/${p.id}`}
                  className="flex items-center justify-between gap-3 rounded-bmpl-md border border-slate-200 p-3 text-sm transition hover:border-belize-light/60"
                >
                  <span className="min-w-0">
                    <span className="truncate font-medium text-belize-navy">{p.title}</span>
                    <span className="ml-2 text-xs text-slate-400">{promotionTypeLabel(p.type)}</span>
                  </span>
                  <StatusBadge status={p.status} kind="promotion" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

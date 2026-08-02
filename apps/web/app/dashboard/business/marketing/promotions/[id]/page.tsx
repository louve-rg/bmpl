'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PROMOTION_PLACEMENT_LABELS, type PromotionStatus } from '@bmpl/shared';
import { type ApiError } from '../../../../../../lib/api';
import {
  marketingApi,
  formatPromoWindow,
  formatCtr,
  type CampaignCard,
  type PromotionDetail,
  type PromotionAnalytics,
  type PlacementInput,
  type TargetInput,
} from '../../../../../../lib/marketing';
import { BusinessMarketingGate } from '../../../../../../components/marketing/BusinessMarketingGate';
import { StatusBadge } from '../../../../../../components/marketing/StatusBadge';
import { PromotionForm, type PromotionDetailsValues } from '../../../../../../components/marketing/PromotionForm';
import { PlacementPicker } from '../../../../../../components/marketing/PlacementPicker';
import { TargetPicker } from '../../../../../../components/marketing/TargetPicker';
import { AssetManager } from '../../../../../../components/marketing/AssetManager';
import { EngagementTotals } from '../../../../../../components/marketing/AnalyticsPanel';
import { Alert, Button, ButtonLink, Card, PageHeader, Spinner } from '../../../../../../components/ui';

const EDITABLE: PromotionStatus[] = ['DRAFT', 'REJECTED', 'MORE_INFO_REQUIRED'];

export default function PromotionManagePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [detail, setDetail] = useState<PromotionDetail | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignCard[]>([]);
  const [analytics, setAnalytics] = useState<PromotionAnalytics | null>(null);
  const [placements, setPlacements] = useState<PlacementInput[]>([]);
  const [targets, setTargets] = useState<TargetInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const syncFromDetail = useCallback((d: PromotionDetail) => {
    setDetail(d);
    setPlacements(d.placements.map((p) => ({ placement: p.placement, position: p.position, categoryId: p.categoryId })));
    setTargets(
      d.targets.map((t) => {
        const base: TargetInput = { targetType: t.targetType };
        if (t.targetType === 'EXTERNAL_LINK' && t.externalUrl) base.externalUrl = t.externalUrl;
        return base;
      }),
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const [d, cs] = await Promise.all([marketingApi.promotion(id), marketingApi.campaigns()]);
      syncFromDetail(d);
      setCampaigns(cs);
      // analytics is best-effort — never blocks the page.
      marketingApi.promotionAnalytics(id).then(setAnalytics).catch(() => {});
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setForbidden(true);
      else if (err.status === 404) setNotFound(true);
      else setError(err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [id, syncFromDetail]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<PromotionDetail>, successReset = true) {
    setError(null);
    setBusy(true);
    try {
      syncFromDetail(await fn());
      if (successReset) marketingApi.promotionAnalytics(id).then(setAnalytics).catch(() => {});
    } catch (e) {
      setError((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails(values: PromotionDetailsValues) {
    await run(() =>
      marketingApi.updatePromotion(id, {
        title: values.title,
        subtitle: values.subtitle,
        description: values.description,
        campaignId: values.campaignId,
        priority: values.priority,
        startAt: values.startAt,
        endAt: values.endAt,
      }),
    );
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
        <Alert tone="error" title="Promotion not found">
          This promotion doesn&apos;t exist or you don&apos;t have access to it.
        </Alert>
        <div className="mt-4">
          <ButtonLink href="/dashboard/business/marketing/promotions" variant="outline">
            Back to promotions
          </ButtonLink>
        </div>
      </div>
    );
  }

  const editable = EDITABLE.includes(detail.status);
  const canSubmit = editable && detail.targets.length > 0;
  const canPause = detail.status === 'APPROVED';
  const canResume = detail.status === 'PAUSED';
  const canArchive = !['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(detail.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title={detail.title}
        description={formatPromoWindow(detail.startAt, detail.endAt)}
        actions={
          <div className="flex items-center gap-2">
            {detail.isActive && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> Serving
              </span>
            )}
            <StatusBadge status={detail.status} kind="promotion" />
          </div>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}
      {detail.moderationReason && (
        <Alert tone={detail.status === 'MORE_INFO_REQUIRED' ? 'warning' : 'info'} title="Reviewer note">
          {detail.moderationReason}
        </Alert>
      )}
      {!editable && (
        <Alert tone="info">
          This promotion is {detail.status.replace(/_/g, ' ').toLowerCase()} and can&apos;t be edited. Pause it (if
          serving) to make changes.
        </Alert>
      )}

      {/* lifecycle actions */}
      <Card className="flex flex-wrap items-center gap-3 p-4">
        {canSubmit && (
          <Button disabled={busy} onClick={() => run(() => marketingApi.submitPromotion(id))}>
            Submit for review
          </Button>
        )}
        {editable && detail.targets.length === 0 && (
          <span className="text-xs text-amber-600">Add at least one target before submitting.</span>
        )}
        {canPause && (
          <Button variant="outline" disabled={busy} onClick={() => run(() => marketingApi.setPromotionStatus(id, 'PAUSE'))}>
            Pause
          </Button>
        )}
        {canResume && (
          <Button variant="outline" disabled={busy} onClick={() => run(() => marketingApi.setPromotionStatus(id, 'RESUME'))}>
            Resume
          </Button>
        )}
        {canArchive && (
          <Button variant="ghost" disabled={busy} onClick={() => run(() => marketingApi.setPromotionStatus(id, 'ARCHIVE'))}>
            Archive
          </Button>
        )}
        <ButtonLink href="/dashboard/business/marketing/promotions" variant="ghost">
          Back
        </ButtonLink>
      </Card>

      {/* details */}
      <Card className="p-5">
        <h2 className="bmpl-eyebrow mb-4">Details</h2>
        <PromotionForm
          key={detail.updatedAt}
          initial={detail}
          campaigns={campaigns}
          submitting={busy}
          submitLabel="Save details"
          onSubmit={saveDetails}
        />
      </Card>

      {/* placements */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="bmpl-eyebrow">Placements</h2>
          <Button size="sm" variant="outline" disabled={busy || !editable} onClick={() => run(() => marketingApi.setPlacements(id, placements))}>
            Save placements
          </Button>
        </div>
        <PlacementPicker value={placements} onChange={setPlacements} disabled={busy || !editable} />
      </Card>

      {/* targets */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="bmpl-eyebrow">Targets</h2>
          <Button size="sm" variant="outline" disabled={busy || !editable} onClick={() => run(() => marketingApi.setTargets(id, targets))}>
            Save targets
          </Button>
        </div>
        <TargetPicker value={targets} onChange={setTargets} disabled={busy || !editable} />
      </Card>

      {/* assets */}
      <AssetManager promotion={detail} onChanged={syncFromDetail} disabled={!editable} />

      {/* analytics */}
      {analytics && (
        <div className="space-y-4">
          <EngagementTotals totals={analytics.totals} title="Performance" />
          {analytics.byPlacement.length > 0 && (
            <Card className="p-5">
              <h2 className="bmpl-eyebrow mb-3">By placement</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[26rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2 pr-3 font-semibold">Placement</th>
                      <th className="pb-2 pr-3 font-semibold">Impr.</th>
                      <th className="pb-2 pr-3 font-semibold">Clicks</th>
                      <th className="pb-2 font-semibold">CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.byPlacement.map((r, i) => (
                      <tr key={`${r.placement ?? 'none'}-${i}`} className="border-t border-slate-100">
                        <td className="py-2 pr-3 text-slate-600">
                          {r.placement ? PROMOTION_PLACEMENT_LABELS[r.placement] : 'Unattributed'}
                        </td>
                        <td className="py-2 pr-3 text-slate-600">{r.impressions.toLocaleString()}</td>
                        <td className="py-2 pr-3 text-slate-600">{r.clicks.toLocaleString()}</td>
                        <td className="py-2 text-slate-600">{formatCtr(r.ctr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

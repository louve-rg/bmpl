'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ApiError } from '../../../../../../lib/api';
import {
  marketingApi,
  type CampaignCard,
  type PlacementInput,
  type TargetInput,
} from '../../../../../../lib/marketing';
import { BusinessMarketingGate } from '../../../../../../components/marketing/BusinessMarketingGate';
import { PromotionForm, type PromotionDetailsValues } from '../../../../../../components/marketing/PromotionForm';
import { PlacementPicker } from '../../../../../../components/marketing/PlacementPicker';
import { TargetPicker } from '../../../../../../components/marketing/TargetPicker';
import { Alert, ButtonLink, Card, PageHeader, Spinner } from '../../../../../../components/ui';

export default function NewPromotionPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignCard[]>([]);
  const [placements, setPlacements] = useState<PlacementInput[]>([]);
  const [targets, setTargets] = useState<TargetInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCampaigns(await marketingApi.campaigns());
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

  async function create(values: PromotionDetailsValues) {
    setError(null);
    setSubmitting(true);
    try {
      const promo = await marketingApi.createPromotion({
        type: values.type,
        title: values.title,
        subtitle: values.subtitle,
        description: values.description,
        campaignId: values.campaignId,
        priority: values.priority,
        startAt: values.startAt,
        endAt: values.endAt,
        placements,
        targets,
      });
      router.push(`/dashboard/business/marketing/promotions/${promo.id}`);
    } catch (e) {
      setError((e as ApiError).message ?? 'Could not create the promotion.');
      setSubmitting(false);
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Marketing" title="New promotion" description="Draft a promotion. It goes to review after you submit it." />
      {error && <Alert tone="error">{error}</Alert>}

      <Card className="p-5">
        <h2 className="bmpl-eyebrow mb-4">Details</h2>
        <PromotionForm
          campaigns={campaigns}
          includeType
          submitting={submitting}
          submitLabel="Create draft"
          onSubmit={create}
          footer={<ButtonLink href="/dashboard/business/marketing/promotions" variant="ghost">Cancel</ButtonLink>}
        />
      </Card>

      <Card className="p-5">
        <h2 className="bmpl-eyebrow mb-1">Placements</h2>
        <p className="mb-4 text-sm text-slate-500">Where should this promotion appear?</p>
        <PlacementPicker value={placements} onChange={setPlacements} disabled={submitting} />
      </Card>

      <Card className="p-5">
        <h2 className="bmpl-eyebrow mb-1">Targets</h2>
        <p className="mb-4 text-sm text-slate-500">What does this promotion link to? You must own each target.</p>
        <TargetPicker value={targets} onChange={setTargets} disabled={submitting} />
      </Card>

      <p className="text-xs text-slate-400">
        Placements and targets are saved with the draft. You can refine them, add creative assets, and submit for review
        on the next screen.
      </p>
    </div>
  );
}

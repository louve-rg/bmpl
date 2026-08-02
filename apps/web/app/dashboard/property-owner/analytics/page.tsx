'use client';

import { useCallback, useEffect, useState } from 'react';
import { type ApiError } from '../../../../lib/api';
import { realEstateApi, type OwnerAnalytics } from '../../../../lib/realestate';
import { AnalyticsPanel } from '../../../../components/realestate/AnalyticsPanel';
import { PropertyOwnerGate } from '../../../../components/realestate/PropertyOwnerGate';
import { Alert, PageHeader, Spinner } from '../../../../components/ui';

export default function OwnerAnalyticsPage() {
  const [data, setData] = useState<OwnerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await realEstateApi.owner.analytics());
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
  if (forbidden) return <PropertyOwnerGate />;
  if (error || !data) return <Alert tone="error">{error ?? 'Failed to load.'}</Alert>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Property owner" title="Analytics" description="Live performance across your listings." />
      <AnalyticsPanel
        stats={[
          { label: 'Total listings', value: data.totalListings },
          { label: 'Active listings', value: data.activeListings },
          { label: 'Total views', value: data.totalViews },
          { label: 'Saves', value: data.saves },
          { label: 'Enquiries', value: data.enquiries },
          { label: 'Viewing requests', value: data.viewingRequests },
        ]}
        byStatus={data.byStatus}
      />
    </div>
  );
}

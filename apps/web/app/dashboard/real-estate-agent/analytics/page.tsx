'use client';

import { useCallback, useEffect, useState } from 'react';
import { type ApiError } from '../../../../lib/api';
import { realEstateApi, type AgentAnalytics } from '../../../../lib/realestate';
import { AnalyticsPanel } from '../../../../components/realestate/AnalyticsPanel';
import { AgentGate } from '../../../../components/realestate/AgentGate';
import { Alert, PageHeader, Spinner } from '../../../../components/ui';

export default function AgentAnalyticsPage() {
  const [data, setData] = useState<AgentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await realEstateApi.agentDashboard.analytics());
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
  if (forbidden) return <AgentGate />;
  if (error || !data) return <Alert tone="error">{error ?? 'Failed to load.'}</Alert>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Real-estate agent" title="Analytics" description="Live performance across listings you manage." />
      <AnalyticsPanel
        stats={[
          { label: 'Assigned listings', value: data.assignedListings },
          { label: 'Active listings', value: data.activeListings },
          { label: 'Total views', value: data.totalViews },
          { label: 'Enquiries', value: data.enquiries },
          { label: 'Viewing requests', value: data.viewingRequests },
          { label: 'Pending assignments', value: data.pendingAssignments },
        ]}
        byStatus={data.byStatus}
      />
    </div>
  );
}

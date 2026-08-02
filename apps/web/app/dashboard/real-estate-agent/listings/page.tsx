'use client';

import { useState } from 'react';
import { realEstateApi } from '../../../../lib/realestate';
import { ListerListings } from '../../../../components/realestate/ListerListings';
import { AgentGate } from '../../../../components/realestate/AgentGate';

export default function AgentListingsPage() {
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) return <AgentGate />;
  return (
    <ListerListings
      api={realEstateApi.agentDashboard}
      eyebrow="Real-estate agent"
      title="Assigned listings"
      description="Listings you manage on behalf of owners."
      detailBase="/dashboard/real-estate-agent/listings"
      emptyDescription="Accept an assignment to start managing a listing."
      onForbidden={() => setForbidden(true)}
    />
  );
}

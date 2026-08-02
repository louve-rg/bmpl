'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { realEstateApi } from '../../../../../lib/realestate';
import { ListingManager } from '../../../../../components/realestate/ListingManager';
import { AgentGate } from '../../../../../components/realestate/AgentGate';

export default function AgentListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) return <AgentGate />;
  return (
    <ListingManager
      api={realEstateApi.agentDashboard}
      listingId={id}
      listPath="/dashboard/real-estate-agent/listings"
      eyebrow="Real-estate agent"
      onForbidden={() => setForbidden(true)}
    />
  );
}

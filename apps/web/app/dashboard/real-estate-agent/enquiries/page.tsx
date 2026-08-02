'use client';

import { useState } from 'react';
import { realEstateApi } from '../../../../lib/realestate';
import { EnquiriesInbox } from '../../../../components/realestate/ListerEnquiries';
import { AgentGate } from '../../../../components/realestate/AgentGate';

export default function AgentEnquiriesPage() {
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) return <AgentGate />;
  return (
    <EnquiriesInbox
      api={realEstateApi.agentDashboard}
      eyebrow="Real-estate agent"
      detailBase="/dashboard/real-estate-agent/enquiries"
      onForbidden={() => setForbidden(true)}
    />
  );
}

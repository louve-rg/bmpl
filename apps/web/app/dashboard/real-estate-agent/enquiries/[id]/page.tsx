'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { realEstateApi } from '../../../../../lib/realestate';
import { EnquiryThread } from '../../../../../components/realestate/ListerEnquiries';
import { AgentGate } from '../../../../../components/realestate/AgentGate';

export default function AgentEnquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) return <AgentGate />;
  return (
    <EnquiryThread
      api={realEstateApi.agentDashboard}
      id={id}
      eyebrow="Real-estate agent"
      listPath="/dashboard/real-estate-agent/enquiries"
      onForbidden={() => setForbidden(true)}
    />
  );
}

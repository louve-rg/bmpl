'use client';

import { useState } from 'react';
import { realEstateApi } from '../../../../lib/realestate';
import { ViewingsInbox } from '../../../../components/realestate/ListerViewings';
import { AgentGate } from '../../../../components/realestate/AgentGate';

export default function AgentViewingsPage() {
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) return <AgentGate />;
  return (
    <ViewingsInbox
      api={realEstateApi.agentDashboard}
      eyebrow="Real-estate agent"
      onForbidden={() => setForbidden(true)}
    />
  );
}

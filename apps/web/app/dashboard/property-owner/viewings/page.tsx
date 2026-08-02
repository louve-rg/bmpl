'use client';

import { useState } from 'react';
import { realEstateApi } from '../../../../lib/realestate';
import { ViewingsInbox } from '../../../../components/realestate/ListerViewings';
import { PropertyOwnerGate } from '../../../../components/realestate/PropertyOwnerGate';

export default function OwnerViewingsPage() {
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) return <PropertyOwnerGate />;
  return (
    <ViewingsInbox
      api={realEstateApi.owner}
      eyebrow="Property owner"
      onForbidden={() => setForbidden(true)}
    />
  );
}

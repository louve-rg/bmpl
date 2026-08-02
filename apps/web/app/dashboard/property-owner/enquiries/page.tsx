'use client';

import { useState } from 'react';
import { realEstateApi } from '../../../../lib/realestate';
import { EnquiriesInbox } from '../../../../components/realestate/ListerEnquiries';
import { PropertyOwnerGate } from '../../../../components/realestate/PropertyOwnerGate';

export default function OwnerEnquiriesPage() {
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) return <PropertyOwnerGate />;
  return (
    <EnquiriesInbox
      api={realEstateApi.owner}
      eyebrow="Property owner"
      detailBase="/dashboard/property-owner/enquiries"
      onForbidden={() => setForbidden(true)}
    />
  );
}

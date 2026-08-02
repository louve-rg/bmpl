'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { realEstateApi } from '../../../../../lib/realestate';
import { EnquiryThread } from '../../../../../components/realestate/ListerEnquiries';
import { PropertyOwnerGate } from '../../../../../components/realestate/PropertyOwnerGate';

export default function OwnerEnquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) return <PropertyOwnerGate />;
  return (
    <EnquiryThread
      api={realEstateApi.owner}
      id={id}
      eyebrow="Property owner"
      listPath="/dashboard/property-owner/enquiries"
      onForbidden={() => setForbidden(true)}
    />
  );
}

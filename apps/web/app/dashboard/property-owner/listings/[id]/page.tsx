'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { realEstateApi } from '../../../../../lib/realestate';
import { ListingManager } from '../../../../../components/realestate/ListingManager';
import { PropertyOwnerGate } from '../../../../../components/realestate/PropertyOwnerGate';

export default function OwnerListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) return <PropertyOwnerGate />;
  return (
    <ListingManager
      api={realEstateApi.owner}
      listingId={id}
      listPath="/dashboard/property-owner/listings"
      eyebrow="Property owner"
      onForbidden={() => setForbidden(true)}
      assignAgent={(agentProfileId) => realEstateApi.owner.assignAgent(id, { agentProfileId })}
    />
  );
}

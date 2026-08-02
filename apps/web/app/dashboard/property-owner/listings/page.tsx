'use client';

import { useState } from 'react';
import { realEstateApi } from '../../../../lib/realestate';
import { ListerListings } from '../../../../components/realestate/ListerListings';
import { PropertyOwnerGate } from '../../../../components/realestate/PropertyOwnerGate';

export default function OwnerListingsPage() {
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) return <PropertyOwnerGate />;
  return (
    <ListerListings
      api={realEstateApi.owner}
      eyebrow="Property owner"
      title="My listings"
      description="Create, submit, and manage your property listings."
      detailBase="/dashboard/property-owner/listings"
      newHref="/dashboard/property-owner/listings/new"
      emptyDescription="Create a listing to start receiving enquiries and viewing requests."
      onForbidden={() => setForbidden(true)}
    />
  );
}

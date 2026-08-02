'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { realEstateApi } from '../../../../../lib/realestate';
import { PropertyForm } from '../../../../../components/realestate/PropertyForm';
import { PropertyOwnerGate } from '../../../../../components/realestate/PropertyOwnerGate';
import { PageHeader } from '../../../../../components/ui';
import type { ApiError } from '../../../../../lib/api';

export default function NewListingPage() {
  const router = useRouter();
  const [forbidden, setForbidden] = useState(false);

  if (forbidden) return <PropertyOwnerGate />;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/dashboard/property-owner/listings" className="text-sm font-medium text-belize-blue hover:underline">
        ← Listings
      </Link>
      <div className="mt-2">
        <PageHeader eyebrow="Property owner" title="New listing" description="Create a draft, then add photos and submit for review." />
      </div>
      <PropertyForm
        submitLabel="Create draft"
        onSubmit={async (body) => {
          try {
            const created = await realEstateApi.owner.createListing(body);
            router.push(`/dashboard/property-owner/listings/${created.id}`);
          } catch (e) {
            if ((e as ApiError).status === 403) {
              setForbidden(true);
              return;
            }
            throw e;
          }
        }}
      />
    </div>
  );
}

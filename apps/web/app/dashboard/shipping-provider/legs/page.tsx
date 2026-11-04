'use client';

import { PageHeader } from '../../../../components/ui';
import { CarrierBreadcrumb } from '../../../../components/shipping-provider/data';
import { LegsManager } from '../../../../components/shipping-provider/LegsManager';

export default function CarrierLegsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <CarrierBreadcrumb current="My Legs" />
      <PageHeader
        title="My Legs"
        description="Legs proposed to your organization, and the ones you've already accepted."
      />
      <LegsManager />
    </div>
  );
}

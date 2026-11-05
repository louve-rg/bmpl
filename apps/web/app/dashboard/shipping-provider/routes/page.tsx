'use client';

import { PageHeader } from '../../../../components/ui';
import { CarrierBreadcrumb } from '../../../../components/shipping-provider/data';
import { RoutesManager } from '../../../../components/shipping-provider/RoutesManager';

export default function CarrierRoutesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <CarrierBreadcrumb current="My Routes" />
      <PageHeader
        title="My Routes"
        description="Claim an available route, release one, and set its weekly schedule and exceptions."
      />
      <RoutesManager />
    </div>
  );
}

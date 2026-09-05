'use client';

import { PageHeader } from '../../../../components/ui';
import { OperatorBreadcrumb } from '../../../../components/passenger-operator/data';
import { RoutesManager } from '../../../../components/passenger-operator/RoutesManager';

export default function OperatorRoutesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <OperatorBreadcrumb current="My Routes" />
      <PageHeader title="My Routes" description="The journeys your service runs — towns, stops, schedule notes and fares." />
      {/* No profile shell: this endpoint's own gate is the APPROVED role,
          which the manager explains itself on a 403. */}
      <RoutesManager />
    </div>
  );
}

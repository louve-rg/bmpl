'use client';

import { PageHeader } from '../../../../components/ui';
import { OperatorBreadcrumb } from '../../../../components/passenger-operator/data';
import { DeparturesManager } from '../../../../components/passenger-operator/DeparturesManager';

export default function OperatorDeparturesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <OperatorBreadcrumb current="Departures" />
      <PageHeader title="Departures" description="Publish and manage the individual departures of your routes." />
      <DeparturesManager />
    </div>
  );
}

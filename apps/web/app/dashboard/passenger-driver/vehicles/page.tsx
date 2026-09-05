'use client';

import { PageHeader } from '../../../../components/ui';
import { PassengerDriverBreadcrumb, PassengerDriverShell } from '../../../../components/passenger-driver/data';
import { PassengerVehicleManager } from '../../../../components/passenger-driver/VehicleManager';

export default function PassengerDriverVehiclesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PassengerDriverBreadcrumb current="My Vehicles" />
      <PageHeader title="My Vehicles" description="The vehicles you carry passengers in, and where their approval stands." />
      <PassengerDriverShell>
        {(data, reload) => <PassengerVehicleManager vehicles={data.vehicles} onDone={reload} />}
      </PassengerDriverShell>
    </div>
  );
}

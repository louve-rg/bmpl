'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Alert, PageHeader, Spinner } from '../../../../components/ui';
import { OperatorBreadcrumb, OperatorShell } from '../../../../components/passenger-operator/data';
import { PassengerVehicleManager } from '../../../../components/passenger-driver/VehicleManager';
import type { PassengerVehicle } from '../../../../lib/passenger-driver';

/** The fleet's vehicles — the same manager as the driver's own, pointed at the fleet endpoint. */
function FleetVehicles() {
  const [vehicles, setVehicles] = useState<PassengerVehicle[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setVehicles(await api.get<PassengerVehicle[]>('/passenger/provider/vehicles'));
      setErr(null);
    } catch (e) {
      setErr((e as { message?: string })?.message ?? 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!vehicles) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  return (
    <PassengerVehicleManager
      vehicles={vehicles}
      onDone={reload}
      apiBase="/passenger/provider/vehicles"
      emptyDescription="Add the vehicles your fleet runs — a departure can only be staffed with an approved vehicle."
    />
  );
}

export default function OperatorVehiclesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <OperatorBreadcrumb current="Fleet Vehicles" />
      <PageHeader title="Fleet Vehicles" description="The vehicles your business runs, and where their approval stands." />
      <OperatorShell>{() => <FleetVehicles />}</OperatorShell>
    </div>
  );
}

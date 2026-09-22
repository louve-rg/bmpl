/**
 * Which of a trip's assignable vehicles can go with a chosen driver — BMPL-164.
 *
 * The server's GET /admin/passengers/trips/:id/assignable-vehicles already
 * answers the hard questions (approval, active, the test boundary, whose
 * fleet) and states the pairing rule IN THE PAYLOAD: ownership FLEET means
 * any eligible driver, ownership DRIVER means only the named owner. This
 * function only applies that stated pairing — it re-implements nothing, and
 * anything with an ownership it does not recognise is offered to nobody
 * (fail closed).
 */

export interface AssignableVehicle {
  id: string;
  type: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  licencePlate: string;
  seatCapacity: number | null;
  ownership: 'FLEET' | 'DRIVER';
  usableByDriverProfileId: string | null;
  usableByDriverName: string | null;
}

export function vehiclesUsableWith(driverProfileId: string, vehicles: AssignableVehicle[]): AssignableVehicle[] {
  return vehicles.filter(
    (v) =>
      v.ownership === 'FLEET' ||
      (v.ownership === 'DRIVER' && v.usableByDriverProfileId === driverProfileId),
  );
}

/** The option line an admin picks from — names the pairing so a fleet
 *  vehicle and a driver's own are never confused. */
export function vehicleOptionLabel(v: AssignableVehicle): string {
  const base = `${v.make} ${v.model} · ${v.licencePlate}`;
  const seats = v.seatCapacity != null ? ` · ${v.seatCapacity} seats` : '';
  const who = v.ownership === 'FLEET' ? 'fleet vehicle' : `own vehicle of ${v.usableByDriverName ?? 'its driver'}`;
  return `${base}${seats} — ${who}`;
}

/**
 * Passenger transportation constants shared by API and browser.
 *
 * Mirrors the Prisma `PassengerVehicleType` enum — a deliberately separate
 * vocabulary from the delivery `VEHICLE_TYPES`: BUS and BOAT are central to
 * carrying people and meaningless for parcels, while BICYCLE and SCOOTER carry
 * parcels but not fare-paying passengers.
 */
export const PASSENGER_VEHICLE_TYPES = ['CAR', 'SUV', 'VAN', 'MINIBUS', 'BUS', 'BOAT', 'MOTORCYCLE', 'OTHER'] as const;
export type PassengerVehicleType = (typeof PASSENGER_VEHICLE_TYPES)[number];

export const PASSENGER_VEHICLE_TYPE_LABELS: Record<PassengerVehicleType, string> = {
  CAR: 'Car',
  SUV: 'SUV',
  VAN: 'Van',
  MINIBUS: 'Minibus',
  BUS: 'Bus',
  BOAT: 'Boat',
  MOTORCYCLE: 'Motorcycle',
  OTHER: 'Other',
};

/** The most seats any passenger vehicle may declare. Generous on purpose — the
 *  biggest coaster buses run about 60; this only exists to reject typos. */
export const MAX_PASSENGER_SEATS = 100;

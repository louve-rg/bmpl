import { describe, expect, it } from 'vitest';
import { vehiclesUsableWith, vehicleOptionLabel, type AssignableVehicle } from './assignable-vehicles';

const fleet: AssignableVehicle = {
  id: 'v_fleet', type: 'VAN', make: 'Toyota', model: 'Hiace', year: 2021, color: 'white',
  licencePlate: 'FLEET-1', seatCapacity: 14, ownership: 'FLEET',
  usableByDriverProfileId: null, usableByDriverName: null,
};
const owned: AssignableVehicle = {
  id: 'v_owned', type: 'CAR', make: 'Honda', model: 'CR-V', year: 2019, color: 'blue',
  licencePlate: 'OWN-2', seatCapacity: 4, ownership: 'DRIVER',
  usableByDriverProfileId: 'drv_a', usableByDriverName: 'Ana',
};

describe('vehiclesUsableWith', () => {
  it('offers fleet vehicles to any driver, owned vehicles only to their owner', () => {
    expect(vehiclesUsableWith('drv_a', [fleet, owned]).map((v) => v.id)).toEqual(['v_fleet', 'v_owned']);
    expect(vehiclesUsableWith('drv_b', [fleet, owned]).map((v) => v.id)).toEqual(['v_fleet']);
  });

  it('fails closed on an ownership it does not recognise', () => {
    const odd = { ...fleet, id: 'v_odd', ownership: 'POOL' as never };
    expect(vehiclesUsableWith('drv_a', [odd])).toEqual([]);
  });
});

describe('vehicleOptionLabel', () => {
  it('names the pairing so fleet and owned are never confused', () => {
    expect(vehicleOptionLabel(fleet)).toBe('Toyota Hiace · FLEET-1 · 14 seats — fleet vehicle');
    expect(vehicleOptionLabel(owned)).toBe('Honda CR-V · OWN-2 · 4 seats — own vehicle of Ana');
  });

  it('tolerates absent seats and an unnamed owner', () => {
    expect(vehicleOptionLabel({ ...fleet, seatCapacity: null })).toBe('Toyota Hiace · FLEET-1 — fleet vehicle');
    expect(vehicleOptionLabel({ ...owned, usableByDriverName: null })).toBe('Honda CR-V · OWN-2 · 4 seats — own vehicle of its driver');
  });
});

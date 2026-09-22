import { describe, expect, it } from 'vitest';
import { tripMapPoints } from './trip-map';

const hub = {
  name: 'San Pedro Airstrip',
  area: 'San Pedro, BELIZE',
  pinnedLocation: { latitude: 17.9139, longitude: -87.9711 },
};
// A door end before acceptance: area only, no pin — the server withholds it.
const lockedDoor = { name: null, area: 'Belize City, BELIZE', pinnedLocation: null };

describe('tripMapPoints', () => {
  it('maps only the ends that actually carry a pin', () => {
    expect(tripMapPoints(hub, lockedDoor)).toEqual([
      { latitude: 17.9139, longitude: -87.9711, label: 'Collect: San Pedro Airstrip' },
    ]);
  });

  it('is empty when nothing is pinned — no map gets drawn from nothing', () => {
    expect(tripMapPoints(lockedDoor, null)).toEqual([]);
    expect(tripMapPoints(null, null)).toEqual([]);
  });

  it('labels an unlocked door end by its area when it has no name', () => {
    const unlockedDoor = { name: null, area: 'Belize City, BELIZE', pinnedLocation: { latitude: 17.4995, longitude: -88.1976 } };
    expect(tripMapPoints(hub, unlockedDoor)).toEqual([
      { latitude: 17.9139, longitude: -87.9711, label: 'Collect: San Pedro Airstrip' },
      { latitude: 17.4995, longitude: -88.1976, label: 'Deliver: Belize City, BELIZE' },
    ]);
  });

  it('tolerates a payload with no pinnedLocation field at all (older API)', () => {
    expect(tripMapPoints({ name: 'X', area: null }, { name: 'Y', area: null })).toEqual([]);
  });

  it('drops a non-finite pin rather than handing it to the map', () => {
    const broken = { name: 'Z', area: null, pinnedLocation: { latitude: Number.NaN, longitude: 1 } };
    expect(tripMapPoints(broken, null)).toEqual([]);
  });
});

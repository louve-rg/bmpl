import { describe, expect, it } from 'vitest';
import { labelStops, stopLetter, tripMapPoints } from './trip-map';

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

describe('stopLetter', () => {
  it('is A first and climbs the alphabet from there', () => {
    expect(stopLetter(0)).toBe('A');
    expect(stopLetter(1)).toBe('B');
    expect(stopLetter(2)).toBe('C');
    expect(stopLetter(3)).toBe('D');
  });
});

describe('labelStops', () => {
  it('labels a two-stop leg A then B — the last stop is B, not padded to D', () => {
    expect(labelStops(tripMapPoints(hub, { ...lockedDoor, pinnedLocation: { latitude: 17.4995, longitude: -88.1976 } }))).toEqual([
      { latitude: 17.9139, longitude: -87.9711, label: 'Collect: San Pedro Airstrip', letter: 'A' },
      { latitude: 17.4995, longitude: -88.1976, label: 'Deliver: Belize City, BELIZE', letter: 'B' },
    ]);
  });

  it('labels a four-stop route A through D, in the order given', () => {
    const points = [
      { latitude: 1, longitude: 1, label: 'Sender' },
      { latitude: 2, longitude: 2, label: 'San Pedro Airstrip' },
      { latitude: 3, longitude: 3, label: 'Belize City terminal' },
      { latitude: 4, longitude: 4, label: 'Recipient' },
    ];
    expect(labelStops(points).map((s) => s.letter)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('is empty when there is nothing to label — no letters invented from nothing', () => {
    expect(labelStops([])).toEqual([]);
  });
});

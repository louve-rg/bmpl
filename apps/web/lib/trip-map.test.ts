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
  it('maps only the stops that actually carry a pin', () => {
    expect(tripMapPoints([hub, lockedDoor])).toEqual([
      { latitude: 17.9139, longitude: -87.9711, label: 'Collect: San Pedro Airstrip' },
    ]);
  });

  it('is empty when nothing is pinned — no map gets drawn from nothing', () => {
    expect(tripMapPoints([lockedDoor, null])).toEqual([]);
    expect(tripMapPoints([null, null])).toEqual([]);
    expect(tripMapPoints([])).toEqual([]);
  });

  it('labels an unlocked door end by its area when it has no name', () => {
    const unlockedDoor = { name: null, area: 'Belize City, BELIZE', pinnedLocation: { latitude: 17.4995, longitude: -88.1976 } };
    expect(tripMapPoints([hub, unlockedDoor])).toEqual([
      { latitude: 17.9139, longitude: -87.9711, label: 'Collect: San Pedro Airstrip' },
      { latitude: 17.4995, longitude: -88.1976, label: 'Deliver: Belize City, BELIZE' },
    ]);
  });

  it('tolerates a payload with no pinnedLocation field at all (older API)', () => {
    expect(tripMapPoints([{ name: 'X', area: null }, { name: 'Y', area: null }])).toEqual([]);
  });

  it('drops a non-finite pin rather than handing it to the map', () => {
    const broken = { name: 'Z', area: null, pinnedLocation: { latitude: Number.NaN, longitude: 1 } };
    expect(tripMapPoints([broken, null])).toEqual([]);
  });

  it('a two-stop journey stays Collect/Deliver — the genuine BMPL-136 shape', () => {
    const dest = { ...lockedDoor, pinnedLocation: { latitude: 17.4995, longitude: -88.1976 } };
    expect(tripMapPoints([hub, dest])).toEqual([
      { latitude: 17.9139, longitude: -87.9711, label: 'Collect: San Pedro Airstrip' },
      { latitude: 17.4995, longitude: -88.1976, label: 'Deliver: Belize City, BELIZE' },
    ]);
  });

  it('labels a real multi-hub journey Collect / Via… / Deliver, in order (BMPL-190)', () => {
    const sender = { name: null, area: 'Belize City, BELIZE', pinnedLocation: { latitude: 17.5, longitude: -88.2 } };
    const hubA = { name: 'Belize City Terminal', area: null, pinnedLocation: { latitude: 17.49, longitude: -88.19 } };
    const hubB = { name: 'San Pedro Airstrip', area: null, pinnedLocation: { latitude: 17.9139, longitude: -87.9711 } };
    const recipient = { name: null, area: 'San Pedro, BELIZE', pinnedLocation: { latitude: 17.92, longitude: -87.96 } };
    expect(tripMapPoints([sender, hubA, hubB, recipient]).map((p) => p.label)).toEqual([
      'Collect: Belize City, BELIZE',
      'Via: Belize City Terminal',
      'Via: San Pedro Airstrip',
      'Deliver: San Pedro, BELIZE',
    ]);
  });

  it('a hidden middle stop does not shift Collect/Deliver off the real ends', () => {
    // The middle hub happens to have no pin for some reason; the two door ends
    // must still read as Collect/Deliver, not slide into Via/Deliver.
    const sender = { name: 'Sender', area: null, pinnedLocation: { latitude: 1, longitude: 1 } };
    const hiddenHub = { name: 'Hub', area: null, pinnedLocation: null };
    const recipient = { name: 'Recipient', area: null, pinnedLocation: { latitude: 2, longitude: 2 } };
    expect(tripMapPoints([sender, hiddenHub, recipient]).map((p) => p.label)).toEqual(['Collect: Sender', 'Deliver: Recipient']);
  });

  it('BMPL-198: a hidden FIRST stop does not push the next visible stop into Via', () => {
    // The sender's door has no pin yet (courier hasn't accepted) — it drops
    // out. The first stop that actually has a pin, a hub, must read as
    // Collect, not inherit Via from its original middle position.
    const sender = { name: 'Sender', area: null, pinnedLocation: null };
    const hubA = { name: 'Belize City Terminal', area: null, pinnedLocation: { latitude: 17.49, longitude: -88.19 } };
    const hubB = { name: 'San Pedro Airstrip', area: null, pinnedLocation: { latitude: 17.9139, longitude: -87.9711 } };
    const recipient = { name: 'Recipient', area: null, pinnedLocation: { latitude: 17.92, longitude: -87.96 } };
    expect(tripMapPoints([sender, hubA, hubB, recipient]).map((p) => p.label)).toEqual([
      'Collect: Belize City Terminal',
      'Via: San Pedro Airstrip',
      'Deliver: Recipient',
    ]);
  });

  it('BMPL-198: a hidden LAST stop does not leave the final visible stop stuck on Via', () => {
    // Mirror case: the recipient's door has no pin yet — it drops out. The
    // last stop that actually has a pin, a hub, must read as Deliver.
    const sender = { name: 'Sender', area: null, pinnedLocation: { latitude: 17.5, longitude: -88.2 } };
    const hubA = { name: 'Belize City Terminal', area: null, pinnedLocation: { latitude: 17.49, longitude: -88.19 } };
    const hubB = { name: 'San Pedro Airstrip', area: null, pinnedLocation: { latitude: 17.9139, longitude: -87.9711 } };
    const recipient = { name: 'Recipient', area: null, pinnedLocation: null };
    expect(tripMapPoints([sender, hubA, hubB, recipient]).map((p) => p.label)).toEqual([
      'Collect: Sender',
      'Via: Belize City Terminal',
      'Deliver: San Pedro Airstrip',
    ]);
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
    const dest = { ...lockedDoor, pinnedLocation: { latitude: 17.4995, longitude: -88.1976 } };
    expect(labelStops(tripMapPoints([hub, dest]))).toEqual([
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

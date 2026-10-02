import { describe, expect, it } from 'vitest';
import { jobMapPoints, pickupView } from './driver-job';

describe('pickupView', () => {
  // BMPL-113: the defect. The API returns pickupLocation: null when the vendor
  // has no pickup location, and the page must not crash on it. This is the test
  // that fails (throws) if the null guard is removed.
  it('reports a missing pickup for null without throwing', () => {
    const view = pickupView(null);
    expect(view.missing).toBe(true);
    expect(view.hasAddress).toBe(false);
    expect(view.addressLine1).toBeNull();
    expect(view.cityLine).toBe('');
    expect(view.navigationUrl).toBeNull();
  });

  it('treats undefined the same as null', () => {
    expect(pickupView(undefined).missing).toBe(true);
  });

  it('maps a fully-populated pickup field-for-field', () => {
    const view = pickupView({
      label: 'Main',
      addressLine1: '5 Depot Road',
      addressLine2: 'Unit 2',
      city: 'Belize City',
      district: 'BELIZE',
      navigationUrl: 'https://maps.example/here',
      pickupInstructions: 'Ask at the counter',
    });
    expect(view.missing).toBe(false);
    expect(view.label).toBe('Main');
    expect(view.addressLine1).toBe('5 Depot Road');
    expect(view.addressLine2).toBe('Unit 2');
    expect(view.cityLine).toBe('Belize City, BELIZE');
    expect(view.instructions).toBe('Ask at the counter');
    expect(view.navigationUrl).toBe('https://maps.example/here');
    expect(view.hasAddress).toBe(true);
  });

  it('replaces underscores in the district and drops absent parts of the city line', () => {
    expect(pickupView({ city: 'Punta Gorda', district: 'TOLEDO' }).cityLine).toBe('Punta Gorda, TOLEDO');
    expect(pickupView({ district: 'STANN_CREEK' }).cityLine).toBe('STANN CREEK');
    expect(pickupView({ city: 'Belmopan' }).cityLine).toBe('Belmopan');
  });

  it('has an address to fall back on when there is a city but no pin', () => {
    const view = pickupView({ city: 'Dangriga', district: 'STANN_CREEK', navigationUrl: null });
    expect(view.hasAddress).toBe(true);
    expect(view.navigationUrl).toBeNull();
  });
});

describe('jobMapPoints (Edward requirement 8, marketplace deliveries)', () => {
  const pickupLocation = {
    label: 'Main counter',
    city: 'Belize City',
    district: 'BELIZE',
    pinnedLocation: { latitude: 17.5, longitude: -88.2 },
  };
  const vendor = { businessName: 'Corner Store' };

  it('pre-acceptance: the vendor pin is drawn, the customer pin is withheld entirely — never a guessed point', () => {
    const points = jobMapPoints({
      pickupLocation,
      vendor,
      deliveryAddress: { city: 'Belmopan', district: 'CAYO' }, // area-only, no fullName yet
      pinnedLocation: null, // the server's own pre-acceptance gate
    });
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ latitude: 17.5, longitude: -88.2, label: 'Collect: Corner Store' });
  });

  it('post-acceptance: both pins are drawn, labelled Collect and Deliver by visible order', () => {
    const points = jobMapPoints({
      pickupLocation,
      vendor,
      deliveryAddress: { fullName: 'Jane Doe', city: 'Belmopan', district: 'CAYO' },
      pinnedLocation: { latitude: 17.25, longitude: -88.77 },
    });
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ latitude: 17.5, longitude: -88.2, label: 'Collect: Corner Store' });
    expect(points[1]).toEqual({ latitude: 17.25, longitude: -88.77, label: 'Deliver: Jane Doe' });
  });

  it('no pickup location at all: only the customer pin draws — a single visible stop reads as the first one, matching tripMapPoints elsewhere', () => {
    const points = jobMapPoints({
      pickupLocation: null,
      vendor,
      deliveryAddress: { fullName: 'Jane Doe', city: 'Belmopan', district: 'CAYO' },
      pinnedLocation: { latitude: 17.25, longitude: -88.77 },
    });
    expect(points).toEqual([{ latitude: 17.25, longitude: -88.77, label: 'Collect: Jane Doe' }]);
  });

  it('nothing pinned anywhere yields an empty list, never an invented point', () => {
    expect(jobMapPoints({ pickupLocation: null, deliveryAddress: null, pinnedLocation: null })).toEqual([]);
    expect(
      jobMapPoints({
        pickupLocation: { city: 'Belize City', district: 'BELIZE' }, // no pinnedLocation
        deliveryAddress: { city: 'Belmopan', district: 'CAYO' },
        pinnedLocation: null,
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { pickupView } from './driver-job';

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

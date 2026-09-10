import { describe, expect, it } from 'vitest';
import type { RecipientTrackingView } from './shipping';
import {
  destinationLine,
  recipientHeadline,
  recipientTrackingPath,
  recipientTrackingUrl,
  stepTone,
} from './recipient-tracking';

function view(overrides: Partial<RecipientTrackingView> = {}): RecipientTrackingView {
  return {
    reference: 'BML-XXXX',
    status: 'IN_TRANSIT',
    statusLabel: 'On the way',
    serviceLabel: 'Door to door',
    bookedAt: null,
    deliveredAt: null,
    destination: { city: 'San Pedro', district: 'BELIZE' },
    collectionHub: null,
    steps: [],
    ...overrides,
  };
}

describe('recipientTrackingPath / recipientTrackingUrl', () => {
  it('builds a token path and encodes it', () => {
    expect(recipientTrackingPath('abc123')).toBe('/track/abc123');
    expect(recipientTrackingPath('a b/c')).toBe('/track/a%20b%2Fc');
  });

  it('joins origin and path without a double slash', () => {
    expect(recipientTrackingUrl('https://bml.bz', 'tok')).toBe('https://bml.bz/track/tok');
    expect(recipientTrackingUrl('https://bml.bz/', 'tok')).toBe('https://bml.bz/track/tok');
  });
});

describe('recipientHeadline', () => {
  it('names the collection terminal only while awaiting collection', () => {
    expect(
      recipientHeadline(
        view({
          status: 'AWAITING_COLLECTION',
          statusLabel: 'Awaiting collection',
          collectionHub: { name: 'San Pedro Water Taxi', city: 'San Pedro', address: null, instructions: null },
        }),
      ),
    ).toBe('Ready to collect at San Pedro Water Taxi');
  });

  it('falls back to the API status label otherwise', () => {
    expect(recipientHeadline(view({ status: 'IN_TRANSIT', statusLabel: 'On the way' }))).toBe('On the way');
    // Awaiting collection with no hub in the payload must not invent a place.
    expect(
      recipientHeadline(view({ status: 'AWAITING_COLLECTION', statusLabel: 'Awaiting collection', collectionHub: null })),
    ).toBe('Awaiting collection');
  });
});

describe('destinationLine', () => {
  it('joins the parts the API returned and drops the missing ones', () => {
    expect(destinationLine(view({ destination: { city: 'San Pedro', district: 'BELIZE' } }))).toBe('San Pedro, BELIZE');
    expect(destinationLine(view({ destination: { city: null, district: 'CAYO' } }))).toBe('CAYO');
    expect(destinationLine(view({ destination: { city: 'Belmopan', district: null } }))).toBe('Belmopan');
    expect(destinationLine(view({ destination: { city: null, district: null } }))).toBe('');
  });
});

describe('stepTone', () => {
  const step = (o: Partial<{ completed: boolean; isCurrent: boolean }>) => ({
    sequence: 1,
    kindLabel: 'Collection',
    modeLabel: 'Road',
    description: 'Collected',
    completed: false,
    isCurrent: false,
    completedAt: null,
    ...o,
  });
  it('is done when completed, current when current, else upcoming', () => {
    expect(stepTone(step({ completed: true }))).toBe('done');
    expect(stepTone(step({ isCurrent: true }))).toBe('current');
    expect(stepTone(step({}))).toBe('upcoming');
    // Completed wins over current — a finished leg is done even if flagged current.
    expect(stepTone(step({ completed: true, isCurrent: true }))).toBe('done');
  });
});

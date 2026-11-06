import { describe, expect, it } from 'vitest';
import { pickupPhotoSection, reportIssueState } from './driver-shipping-job';

describe('pickupPhotoSection', () => {
  it('is hidden before the driver has accepted — nothing to photograph at a door you have not committed to', () => {
    // Post-SHIP-B wire shape: addressUnlocked is already true from offer time; contactUnlocked is the real gate.
    expect(pickupPhotoSection({ addressUnlocked: true, contactUnlocked: false }, true)).toBe('hidden');
    expect(pickupPhotoSection({ addressUnlocked: true, contactUnlocked: false, pickupPhotoUrls: ['x'] }, true)).toBe('hidden');
  });

  it('offers "add" once accepted, with no photo attached yet, while the leg still has a next action', () => {
    expect(pickupPhotoSection({ addressUnlocked: true, contactUnlocked: true }, true)).toBe('addable');
    expect(pickupPhotoSection({ addressUnlocked: true, contactUnlocked: true, pickupPhotoUrls: [] }, true)).toBe('addable');
  });

  it('falls back to addressUnlocked when contactUnlocked is absent — an api deploy older than SHIP-B', () => {
    expect(pickupPhotoSection({ addressUnlocked: false }, true)).toBe('hidden');
    expect(pickupPhotoSection({ addressUnlocked: true }, true)).toBe('addable');
  });

  it('hides once the leg has no next action (COMPLETED/CANCELLED/EXCEPTION) and nothing was ever attached', () => {
    expect(pickupPhotoSection({ addressUnlocked: true, contactUnlocked: true }, false)).toBe('hidden');
  });

  it('shows the existing photo, never the "add" control, once one is attached — the client cannot safely add a second from a fresh session', () => {
    expect(pickupPhotoSection({ addressUnlocked: true, contactUnlocked: true, pickupPhotoUrls: ['https://example.com/a.jpg'] }, true)).toBe('existing');
    // Still shown even once the leg has finished — evidence stays visible after completion.
    expect(pickupPhotoSection({ addressUnlocked: true, contactUnlocked: true, pickupPhotoUrls: ['https://example.com/a.jpg'] }, false)).toBe('existing');
  });

  it('does not throw when pickupPhotoUrls is absent entirely — a real missing wire field, not an in-memory undefined', () => {
    const raw = JSON.parse(JSON.stringify({ addressUnlocked: true, contactUnlocked: true })) as {
      addressUnlocked: boolean;
      contactUnlocked?: boolean;
      pickupPhotoUrls?: string[];
    };
    expect(() => pickupPhotoSection(raw, true)).not.toThrow();
    expect(pickupPhotoSection(raw, true)).toBe('addable');
  });
});

describe('reportIssueState', () => {
  it('is available once the driver actually holds the parcel — PICKUP_CONFIRMED, IN_TRANSIT, ARRIVING', () => {
    expect(reportIssueState('PICKUP_CONFIRMED', false)).toBe('available');
    expect(reportIssueState('IN_TRANSIT', false)).toBe('available');
    expect(reportIssueState('ARRIVING', false)).toBe('available');
  });

  it('is unavailable before pickup — nothing attempted yet, matching the server\'s own refusal window', () => {
    expect(reportIssueState('ASSIGNED', false)).toBe('unavailable');
    expect(reportIssueState('DRIVER_ACCEPTED', false)).toBe('unavailable');
  });

  it('is unavailable once the leg is terminal — DELIVERED, CANCELLED', () => {
    expect(reportIssueState('DELIVERED', false)).toBe('unavailable');
    expect(reportIssueState('CANCELLED', false)).toBe('unavailable');
  });

  it('is "reported" once this session has already reported, regardless of status — a stale reportable status must never offer the control again', () => {
    expect(reportIssueState('IN_TRANSIT', true)).toBe('reported');
    expect(reportIssueState('ASSIGNED', true)).toBe('reported');
  });
});

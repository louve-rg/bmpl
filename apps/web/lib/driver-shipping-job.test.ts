import { describe, expect, it } from 'vitest';
import { pickupPhotoSection } from './driver-shipping-job';

describe('pickupPhotoSection', () => {
  it('is hidden before the driver has accepted — nothing to photograph at a locked door', () => {
    expect(pickupPhotoSection({ addressUnlocked: false }, true)).toBe('hidden');
    expect(pickupPhotoSection({ addressUnlocked: false, pickupPhotoUrls: ['x'] }, true)).toBe('hidden');
  });

  it('offers "add" once accepted, with no photo attached yet, while the leg still has a next action', () => {
    expect(pickupPhotoSection({ addressUnlocked: true }, true)).toBe('addable');
    expect(pickupPhotoSection({ addressUnlocked: true, pickupPhotoUrls: [] }, true)).toBe('addable');
  });

  it('hides once the leg has no next action (COMPLETED/CANCELLED/EXCEPTION) and nothing was ever attached', () => {
    expect(pickupPhotoSection({ addressUnlocked: true }, false)).toBe('hidden');
  });

  it('shows the existing photo, never the "add" control, once one is attached — the client cannot safely add a second from a fresh session', () => {
    expect(pickupPhotoSection({ addressUnlocked: true, pickupPhotoUrls: ['https://example.com/a.jpg'] }, true)).toBe('existing');
    // Still shown even once the leg has finished — evidence stays visible after completion.
    expect(pickupPhotoSection({ addressUnlocked: true, pickupPhotoUrls: ['https://example.com/a.jpg'] }, false)).toBe('existing');
  });

  it('does not throw when pickupPhotoUrls is absent entirely — a real missing wire field, not an in-memory undefined', () => {
    const raw = JSON.parse(JSON.stringify({ addressUnlocked: true })) as { addressUnlocked: boolean; pickupPhotoUrls?: string[] };
    expect(() => pickupPhotoSection(raw, true)).not.toThrow();
    expect(pickupPhotoSection(raw, true)).toBe('addable');
  });
});

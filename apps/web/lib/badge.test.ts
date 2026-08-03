import { describe, expect, it } from 'vitest';
import { badgeCount, unreadLabel } from './badge';

describe('badgeCount', () => {
  it('renders the number when within range', () => {
    expect(badgeCount(1)).toBe('1');
    expect(badgeCount(42)).toBe('42');
    expect(badgeCount(99)).toBe('99');
  });

  it('caps above the max (default 99)', () => {
    expect(badgeCount(100)).toBe('99+');
    expect(badgeCount(1000)).toBe('99+');
    expect(badgeCount(20, 9)).toBe('9+');
  });

  it('returns an empty string when there is nothing to show', () => {
    expect(badgeCount(0)).toBe('');
    expect(badgeCount(-5)).toBe('');
    expect(badgeCount(Number.NaN)).toBe('');
  });

  it('floors fractional counts', () => {
    expect(badgeCount(3.9)).toBe('3');
  });
});

describe('unreadLabel', () => {
  it('describes the unread count for assistive tech', () => {
    expect(unreadLabel(0)).toBe('0 unread');
    expect(unreadLabel(1)).toBe('1 unread');
    expect(unreadLabel(150)).toBe('150 unread');
  });

  it('normalizes bad input to a non-negative integer', () => {
    expect(unreadLabel(-3)).toBe('0 unread');
    expect(unreadLabel(2.7)).toBe('2 unread');
    expect(unreadLabel(Number.NaN)).toBe('0 unread');
  });
});

import { describe, expect, it } from 'vitest';
import { formatClock, formatWindow } from './availability-window';

describe('formatClock', () => {
  it('formats midnight, noon and ordinary hours as 12-hour with AM/PM', () => {
    expect(formatClock('00:00')).toBe('12:00 AM');
    expect(formatClock('12:00')).toBe('12:00 PM');
    expect(formatClock('08:05')).toBe('8:05 AM');
    expect(formatClock('22:00')).toBe('10:00 PM');
  });
});

describe('formatWindow', () => {
  it('renders a same-day window plainly', () => {
    expect(formatWindow({ startTime: '08:00', endTime: '12:00' })).toBe('8:00 AM–12:00 PM');
  });

  it('flags an overnight window (endTime earlier than startTime) rather than showing an invalid range', () => {
    expect(formatWindow({ startTime: '22:00', endTime: '02:00' })).toBe('10:00 PM–2:00 AM (overnight)');
  });
});

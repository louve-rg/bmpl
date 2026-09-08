import { describe, expect, it } from 'vitest';
import { riderAccessView, riderBookingView, seatsLeft, stopLabel } from './passenger-travel';

describe('seatsLeft', () => {
  it('is unknowable until a vehicle is assigned — null, never an invented number', () => {
    expect(seatsLeft(null, 0)).toBeNull();
    expect(seatsLeft(null, 5)).toBeNull();
  });

  it('counts down from the snapshot and never goes negative', () => {
    expect(seatsLeft(14, 0)).toBe(14);
    expect(seatsLeft(14, 11)).toBe(3);
    expect(seatsLeft(14, 14)).toBe(0);
    expect(seatsLeft(14, 20)).toBe(0);
  });
});

describe('riderBookingView — the held-at-confirmation rule, in the copy', () => {
  it('REQUESTED says plainly that no seat is held', () => {
    const v = riderBookingView('REQUESTED');
    expect(v.detail).toContain('No seat is held');
    expect(v.tone).toBe('warning');
    expect(v.cancellable).toBe(true);
  });

  it('CONFIRMED is the only state that says seats are held', () => {
    const v = riderBookingView('CONFIRMED');
    expect(v.detail).toContain('held');
    expect(v.tone).toBe('success');
    expect(v.cancellable).toBe(true);
  });

  it('settled states offer no cancel', () => {
    expect(riderBookingView('COMPLETED').cancellable).toBe(false);
    expect(riderBookingView('CANCELLED').cancellable).toBe(false);
  });

  it('an unknown status renders as itself rather than guessing', () => {
    const v = riderBookingView('EXPIRED');
    expect(v.label).toBe('EXPIRED');
    expect(v.cancellable).toBe(false);
  });
});

describe('stopLabel', () => {
  it('uses the operator-given stop name when there is one', () => {
    expect(stopLabel({ name: 'Market Square', city: 'Belmopan' })).toBe('Market Square');
  });

  it('falls back to the town — operator data, never an invented name', () => {
    expect(stopLabel({ name: null, city: 'Belmopan' })).toBe('Belmopan');
    expect(stopLabel({ name: '   ', city: 'Belmopan' })).toBe('Belmopan');
  });
});

describe('riderAccessView — a restricted account is told calmly, not alarmed', () => {
  it('renders a 403 as a plain account restriction carrying the server’s words', () => {
    const v = riderAccessView(403, 'Your Customer role is suspended.');
    expect(v.kind).toBe('restricted');
    if (v.kind === 'restricted') {
      expect(v.title).toBe('Not available on your account');
      // Verbatim: the server's sentence is the authority on what they are told.
      expect(v.detail).toBe('Your Customer role is suspended.');
    }
  });

  it('leaves every other failure an error — a malfunction must still look like one', () => {
    expect(riderAccessView(500, 'boom').kind).toBe('error');
    expect(riderAccessView(undefined, 'network down').kind).toBe('error');
  });
});

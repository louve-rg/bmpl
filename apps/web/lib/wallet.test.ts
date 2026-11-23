import { describe, expect, it } from 'vitest';
import { bzd, describeTransaction } from './wallet';

describe('bzd', () => {
  it('formats minor units as Belize dollars with cents', () => {
    expect(bzd(12345)).toBe('BZ$123.45');
    expect(bzd(0)).toBe('BZ$0.00');
  });

  it('groups thousands with commas, and changes no digit', () => {
    expect(bzd(99999999999)).toBe('BZ$999,999,999.99');
    expect(bzd(123456789)).toBe('BZ$1,234,567.89');
    expect(bzd(100000)).toBe('BZ$1,000.00');
    expect(bzd(99999)).toBe('BZ$999.99');
  });

  it('keeps the sign where it was', () => {
    expect(bzd(-1250)).toBe('BZ$-12.50');
    expect(bzd(-123456)).toBe('BZ$-1,234.56');
  });
});

/**
 * WALLET-P2P-WEB: a TRANSFER row only reads as "Sent to X" / "Received from
 * Y" once the history endpoint has been taught to resolve `counterpartyName`
 * -- a row on the OLD shape (no counterparty at all, e.g. the ledger-entries
 * detail page's own type) must fall through to a generic line rather than
 * rendering a direction with nobody's name attached to it.
 */
describe('describeTransaction TRANSFER rows (WALLET-P2P-WEB)', () => {
  it('reads "Sent to <name>" for an outgoing transfer', () => {
    expect(describeTransaction({ type: 'TRANSFER', description: null, direction: 'OUT', counterpartyName: 'Pamela B.' })).toBe(
      'Sent to Pamela B.',
    );
  });

  it('reads "Received from <name>" for an incoming transfer', () => {
    expect(describeTransaction({ type: 'TRANSFER', description: null, direction: 'IN', counterpartyName: 'Edward B.' })).toBe(
      'Received from Edward B.',
    );
  });

  it('falls back to the generic line when counterpartyName is absent, rather than naming a direction with no name to go with it', () => {
    expect(describeTransaction({ type: 'TRANSFER', description: null })).toBe('Wallet transfer');
    expect(describeTransaction({ type: 'TRANSFER', description: 'Something else' })).toBe('Something else');
  });
});

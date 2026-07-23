import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  assertMoneyMovementEnabled,
  buildTransfer,
  deriveBalance,
  LedgerError,
  type DraftTransaction,
} from './index';

const base = { type: 'TRANSFER', currency: 'BZD' } as const;

describe('double-entry ledger invariants', () => {
  it('accepts a balanced two-line transfer', () => {
    const draft = buildTransfer({
      ...base,
      fromAccountId: 'a',
      toAccountId: 'b',
      amountMinor: 1000n,
    });
    expect(assertBalanced(draft)).toBe(0n);
  });

  it('rejects an unbalanced transaction', () => {
    const draft: DraftTransaction = {
      ...base,
      lines: [
        { accountId: 'a', direction: 'DEBIT', amountMinor: 1000n },
        { accountId: 'b', direction: 'CREDIT', amountMinor: 900n },
      ],
    };
    expect(() => assertBalanced(draft)).toThrow(LedgerError);
    expect(() => assertBalanced(draft)).toThrow(/unbalanced/i);
  });

  it('rejects a single-sided transaction', () => {
    const draft: DraftTransaction = {
      ...base,
      lines: [
        { accountId: 'a', direction: 'DEBIT', amountMinor: 500n },
        { accountId: 'b', direction: 'DEBIT', amountMinor: 500n },
      ],
    };
    expect(() => assertBalanced(draft)).toThrow(/debit and a credit/i);
  });

  it('rejects non-positive amounts', () => {
    const draft: DraftTransaction = {
      ...base,
      lines: [
        { accountId: 'a', direction: 'DEBIT', amountMinor: 0n },
        { accountId: 'b', direction: 'CREDIT', amountMinor: 0n },
      ],
    };
    expect(() => assertBalanced(draft)).toThrow(/positive/i);
  });

  it('rejects an empty transaction', () => {
    expect(() => assertBalanced({ ...base, lines: [] })).toThrow(/no ledger lines/i);
  });

  it('derives an account balance from entries (credit positive, debit negative)', () => {
    expect(
      deriveBalance([
        { accountId: 'x', direction: 'CREDIT', amountMinor: 1000n },
        { accountId: 'x', direction: 'DEBIT', amountMinor: 250n },
      ]),
    ).toBe(750n);
  });

  it('keeps real-money movement disabled during foundation phases', () => {
    expect(() => assertMoneyMovementEnabled(false)).toThrow(/not enabled/i);
    expect(() => assertMoneyMovementEnabled(true)).not.toThrow();
  });
});

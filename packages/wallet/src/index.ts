import type { Currency, LedgerDirection, WalletTransactionType } from '@bmpl/shared';

/**
 * Double-entry ledger primitives.
 *
 * The rules encoded here are the financial source of truth: every transaction
 * is a set of DEBIT/CREDIT entries that MUST net to zero. Account balances are
 * always DERIVED by summing entries — never stored as an editable field.
 *
 * Phase 1 ships this architecture only. `assertMoneyMovementEnabled` is the
 * single choke point that keeps real-money postings switched off until the
 * payment/regulatory design is finalized.
 */

export interface LedgerLine {
  accountId: string;
  direction: LedgerDirection;
  /** Positive minor units (cents). Sign is carried by `direction`. */
  amountMinor: bigint;
}

export interface DraftTransaction {
  type: WalletTransactionType;
  currency: Currency;
  reference?: string;
  description?: string;
  lines: LedgerLine[];
  metadata?: Record<string, unknown>;
}

export class LedgerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'UNBALANCED'
      | 'EMPTY'
      | 'NON_POSITIVE_AMOUNT'
      | 'SINGLE_SIDED'
      | 'MONEY_MOVEMENT_DISABLED',
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** Signed contribution of a line to its account balance. */
export function signedAmount(line: LedgerLine): bigint {
  return line.direction === 'CREDIT' ? line.amountMinor : -line.amountMinor;
}

/**
 * Validate a draft transaction against the double-entry invariants. Throws
 * LedgerError on any violation. Returns the (zero) net sum on success.
 */
export function assertBalanced(draft: DraftTransaction): bigint {
  if (draft.lines.length === 0) {
    throw new LedgerError('Transaction has no ledger lines.', 'EMPTY');
  }
  const hasDebit = draft.lines.some((l) => l.direction === 'DEBIT');
  const hasCredit = draft.lines.some((l) => l.direction === 'CREDIT');
  if (!hasDebit || !hasCredit) {
    throw new LedgerError('Transaction must have both a debit and a credit side.', 'SINGLE_SIDED');
  }
  let net = 0n;
  for (const line of draft.lines) {
    if (line.amountMinor <= 0n) {
      throw new LedgerError('Ledger amounts must be positive.', 'NON_POSITIVE_AMOUNT');
    }
    net += signedAmount(line);
  }
  if (net !== 0n) {
    throw new LedgerError(`Transaction is unbalanced by ${net} minor units.`, 'UNBALANCED');
  }
  return net;
}

/** Derive an account balance from its ledger entries (the source of truth). */
export function deriveBalance(entries: LedgerLine[]): bigint {
  return entries.reduce((sum, e) => sum + signedAmount(e), 0n);
}

/**
 * Hard gate keeping real-money movement disabled during foundation phases.
 * Call before persisting any transaction that represents actual value transfer.
 */
export function assertMoneyMovementEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new LedgerError(
      'Real-money wallet movement is not enabled in this phase.',
      'MONEY_MOVEMENT_DISABLED',
    );
  }
}

/** Convenience: build a simple two-line transfer between two accounts. */
export function buildTransfer(params: {
  type: WalletTransactionType;
  currency: Currency;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: bigint;
  reference?: string;
  description?: string;
}): DraftTransaction {
  return {
    type: params.type,
    currency: params.currency,
    reference: params.reference,
    description: params.description,
    lines: [
      { accountId: params.fromAccountId, direction: 'DEBIT', amountMinor: params.amountMinor },
      { accountId: params.toAccountId, direction: 'CREDIT', amountMinor: params.amountMinor },
    ],
  };
}

/**
 * Wallet foundation constants (double-entry ledger).
 *
 * Phase 1 builds ARCHITECTURE ONLY. No real money moves. Balances are always
 * DERIVED from ledger entries — there is no editable balance field anywhere.
 */

/** Account owner kind. Mirrors Prisma `WalletAccountType`. */
export const WALLET_ACCOUNT_TYPES = [
  'USER', // a user's spendable balance
  'SYSTEM_ESCROW', // funds held in escrow between parties
  'SYSTEM_PLATFORM_FEES', // platform revenue
  'SYSTEM_TOPUP_CLEARING', // incoming top-ups awaiting settlement
  'SYSTEM_PAYOUTS_CLEARING', // outgoing withdrawals awaiting settlement
] as const;
export type WalletAccountType = (typeof WALLET_ACCOUNT_TYPES)[number];

/** Operational state of a wallet account (M12). Mirrors Prisma `WalletAccountStatus`. */
export const WALLET_ACCOUNT_STATUSES = ['ACTIVE', 'LOCKED', 'SUSPENDED'] as const;
export type WalletAccountStatus = (typeof WALLET_ACCOUNT_STATUSES)[number];

/** Each ledger entry is a DEBIT or CREDIT. Entries of a transaction sum to zero. */
export const LEDGER_DIRECTIONS = ['DEBIT', 'CREDIT'] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

/** Business meaning of a transaction. Mirrors Prisma `WalletTransactionType`. */
export const WALLET_TRANSACTION_TYPES = [
  'TOPUP',
  'PAYMENT',
  'VENDOR_EARNING',
  'DRIVER_EARNING',
  'REFUND',
  'ESCROW_HOLD',
  'ESCROW_RELEASE',
  'PLATFORM_FEE',
  'TRANSFER',
  'WITHDRAWAL',
  'ADJUSTMENT',
] as const;
export type WalletTransactionType = (typeof WALLET_TRANSACTION_TYPES)[number];

export const WALLET_TRANSACTION_STATUSES = [
  'PENDING',
  'POSTED',
  'FAILED',
  'REVERSED',
] as const;
export type WalletTransactionStatus = (typeof WALLET_TRANSACTION_STATUSES)[number];

/** Supported settlement currency. BZD is primary. */
export const CURRENCIES = ['BZD', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Whether any real-money movement is permitted. Hard-off during foundation phases. */
export const WALLET_MONEY_MOVEMENT_ENABLED = false;

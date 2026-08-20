import { api } from './api';

/**
 * The BMPL wallet, from the customer's side.
 *
 * Three numbers that have to add up and mean what they say — available is what
 * can be spent now, on hold is committed to orders in flight, total is the two
 * together. The server computes all three; nothing here does arithmetic on
 * somebody's money.
 */

export interface WalletSummary {
  currency: string;
  availableMinor: number;
  onHoldMinor: number;
  totalMinor: number;
  status: 'ACTIVE' | 'LOCKED' | 'SUSPENDED';
  exists: boolean;
}

export interface WalletTransactionRow {
  id: string;
  type: string;
  status: string;
  currency: string;
  description: string | null;
  isTest: boolean;
  signedMinor: number;
  direction: 'IN' | 'OUT';
  postedAt: string | null;
  createdAt: string;
}

export const walletApi = {
  summary: () => api.get<WalletSummary>('/wallet'),
  transactions: () => api.get<WalletTransactionRow[]>('/wallet/transactions'),
  topUp: (amountMinor: number) => api.post<WalletSummary>('/wallet/top-up', { amountMinor }),
};

/** Minor units as Belize dollars. */
export function bzd(minor: number): string {
  return `BZ$${(minor / 100).toFixed(2)}`;
}

/**
 * What a wallet movement is, in words a customer recognises.
 *
 * The ledger's own vocabulary is right for accounting and wrong for a person
 * looking at their own money: nobody thinks "ESCROW_HOLD", they think "held for
 * an order".
 */
export function describeTransaction(t: WalletTransactionRow): string {
  switch (t.type) {
    case 'TOPUP':
      return 'Money added';
    case 'ESCROW_HOLD':
      return 'Held for an order';
    case 'ESCROW_RELEASE':
      return 'Hold released';
    case 'PAYMENT':
      return 'Order payment';
    case 'REFUND':
      return 'Refund';
    case 'VENDOR_EARNING':
    case 'DRIVER_EARNING':
      return 'Earnings';
    case 'WITHDRAWAL':
      return 'Withdrawal';
    default:
      return t.description ?? 'Wallet activity';
  }
}

/**
 * What to tell a customer about a payment, given its state.
 *
 * Replaces "Payment processing coming next — no funds have moved", which stopped
 * being true the moment the wallet went live and would otherwise have told
 * somebody their money was untouched while it sat in escrow.
 */
export function paymentExplanation(status: string, amountMinor: number): string {
  switch (status) {
    case 'AUTHORIZED':
      return `Your payment has been authorized and ${bzd(amountMinor)} is being held securely until the order is completed.`;
    case 'CAPTURED':
    case 'SETTLED':
      return `Payment of ${bzd(amountMinor)} is complete.`;
    case 'PENDING':
    case 'CREATED':
      return `${bzd(amountMinor)} is reserved against this order. Nothing has left your wallet yet.`;
    case 'FAILED':
      return "We couldn't authorize your wallet payment. No funds were charged.";
    case 'CANCELLED':
      return 'The payment hold was released. No funds were charged.';
    case 'REFUNDED':
      return `${bzd(amountMinor)} was refunded to your wallet.`;
    case 'EXPIRED':
      return 'This payment expired before it was completed. No funds were charged.';
    default:
      return `Payment status: ${status.toLowerCase()}.`;
  }
}

/**
 * Can this order be paid for right now?
 *
 * Answered BEFORE the customer commits, so an empty wallet is a sentence they
 * can act on rather than a cancelled order they have to work out for themselves.
 */
export function affordability(totalMinor: number, wallet: WalletSummary | null) {
  if (!wallet) return { known: false as const };
  const short = totalMinor - wallet.availableMinor;
  return {
    known: true as const,
    sufficient: short <= 0,
    shortfallMinor: Math.max(0, short),
    message:
      short <= 0
        ? null
        : `Your wallet balance is ${bzd(wallet.availableMinor)}. This order requires ${bzd(totalMinor)}.`,
  };
}

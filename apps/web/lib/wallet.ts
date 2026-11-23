import { api } from './api';

/**
 * The BML wallet, from the customer's side.
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
  /**
   * WALLET-P2P-WEB: only present on a TRANSFER row -- the API resolves it
   * relative to the caller, same as `TransferReceipt.counterpartyName` below.
   * Every other row type has no counterparty at all, so this stays optional
   * rather than widening every existing row shape.
   */
  counterpartyName?: string | null;
}

/** The paginated shape `GET /wallet/transactions` returns — real pagination, not a raised cap. */
export interface WalletTransactionHistory {
  rows: WalletTransactionRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** One ledger line of a transaction, exactly as the server posted it — never resummed in the browser. */
export interface WalletTransactionEntry {
  direction: 'CREDIT' | 'DEBIT';
  amountMinor: number;
  accountType: string;
  isCustomer: boolean;
}

/** `GET /wallet/transactions/:id` — the detail view. Ownership is enforced server-side: a transaction with none of your entries 404s rather than being filtered client-side. */
export interface WalletTransactionDetail {
  id: string;
  type: string;
  status: string;
  currency: string;
  isTest: boolean;
  reference: string | null;
  description: string | null;
  postedAt: string | null;
  createdAt: string;
  entries: WalletTransactionEntry[];
  balanced: boolean;
}

/**
 * TEMPORARY UAT FEATURE — self-issued simulation funds.
 *
 * `enabled: false` is what the server says when the feature is switched off,
 * and the page renders nothing at all in that case. Note there is no argument
 * to `claimTestFunds` — the amount and the recipient are both the server's to
 * decide, and there is deliberately nothing here for a client to influence.
 */
export interface TestFundingStatus {
  enabled: boolean;
  amountMinor?: number;
  capMinor?: number;
  grantedMinor?: number;
  remainingMinor?: number;
  claimed?: boolean;
}

export interface TestFundingResult {
  transactionId: string;
  creditedMinor: number;
  cumulativeMinor: number;
  remainingMinor: number;
  wallet: WalletSummary;
}

/**
 * WALLET-P2P-WEB: `POST /wallet/transfers/recipient-lookup`. Deliberately
 * thin -- `displayName` is first name + last initial only ("Pamela B."),
 * nothing else about the recipient ever leaves the server. A 404 (unknown,
 * suspended or ineligible -- all three the SAME message, so a sender can
 * never tell which) is a real `ApiError` from `api.post`, not a field on
 * this type; render `e.message` verbatim, never a softened version.
 */
export interface RecipientLookup {
  recipientUserId: string;
  displayName: string;
}

/**
 * `POST /wallet/transfers` (sending) and `GET /wallet/transfers/:id`
 * (the privacy-scoped receipt, reachable later from a history row) share
 * this exact shape. `direction`/`counterpartyName` are always relative to
 * whoever is asking -- the sender sees SENT + the recipient's name, the
 * recipient sees RECEIVED + the sender's name, from the SAME transaction.
 * `replayed` is only ever present (and true) on the 200 idempotent-replay
 * response to a repeated `POST /wallet/transfers`; a fresh 201 omits it.
 */
export interface TransferReceipt {
  transactionId: string;
  reference: string;
  direction: 'SENT' | 'RECEIVED';
  amountMinor: number;
  currency: string;
  status: string;
  counterpartyName: string;
  note: string | null;
  postedAt: string;
  isTest: boolean;
  replayed?: boolean;
}

export const walletApi = {
  summary: () => api.get<WalletSummary>('/wallet'),
  transactions: (page = 1, pageSize = 20) =>
    api.get<WalletTransactionHistory>(`/wallet/transactions?page=${page}&pageSize=${pageSize}`),
  transaction: (id: string) => api.get<WalletTransactionDetail>(`/wallet/transactions/${encodeURIComponent(id)}`),
  topUp: (amountMinor: number) => api.post<WalletSummary>('/wallet/top-up', { amountMinor }),
  testFundingStatus: () => api.get<TestFundingStatus>('/wallet/test-funding'),
  claimTestFunds: () => api.post<TestFundingResult>('/wallet/test-fund', {}),
  recipientLookup: (email: string) => api.post<RecipientLookup>('/wallet/transfers/recipient-lookup', { email }),
  sendMoney: (body: { recipientUserId: string; amountMinor: number; idempotencyKey: string; note?: string }) =>
    api.post<TransferReceipt>('/wallet/transfers', body),
  transferReceipt: (transactionId: string) =>
    api.get<TransferReceipt>(`/wallet/transfers/${encodeURIComponent(transactionId)}`),
};

/**
 * Minor units as Belize dollars, with thousands separators (display only). The digits and
 * rounding are the same as before: toFixed(2) of the major amount. Never feed this output
 * back into an input: the three amount inputs parse plain digits.
 */
export function bzd(minor: number): string {
  const [whole, cents] = (Math.abs(minor) / 100).toFixed(2).split('.');
  const sign = minor < 0 ? '-' : '';
  return 'BZ$' + sign + whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + cents;
}

/**
 * What a wallet movement is, in words a customer recognises.
 *
 * The ledger's own vocabulary is right for accounting and wrong for a person
 * looking at their own money: nobody thinks "ESCROW_HOLD", they think "held for
 * an order".
 */
export function describeTransaction(t: {
  type: string;
  description: string | null;
  direction?: 'IN' | 'OUT';
  counterpartyName?: string | null;
}): string {
  switch (t.type) {
    case 'TOPUP':
      // The server's own words when it has them: "Self-Service Test Credit"
      // and "Administrative Test Credit" say what the money actually is, and
      // flattening both to "Money added" is how a tester ends up believing BML
      // gave them real Belize dollars.
      return t.description ?? 'Money added';
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
    case 'TRANSFER':
      // WALLET-P2P-WEB: `counterpartyName` only arrives on a row the history
      // endpoint has been taught to resolve it for -- a caller still on the
      // old shape (e.g. the ledger-entries detail page, which never asked
      // for it) falls through to the generic line below rather than guessing
      // a direction with no name to go with it.
      return t.counterpartyName
        ? t.direction === 'IN'
          ? `Received from ${t.counterpartyName}`
          : `Sent to ${t.counterpartyName}`
        : t.description ?? 'Wallet transfer';
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

import { api } from './api';
import { money } from './cart';

export { money };

export interface PaymentCard {
  id: string;
  paymentNumber: string;
  orderNumber: string;
  itemCount: number;
  status: string;
  methodType: string;
  amountMinor: number;
  currency: string;
  holdStatus: string | null;
  createdAt: string;
}

export interface WalletHoldView {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  heldAt: string;
  authorizedAt: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
  walletTransactionId: string | null;
}

export interface PaymentDetail {
  id: string;
  paymentNumber: string;
  status: string;
  methodType: string;
  amountMinor: number;
  currency: string;
  authorizedAt: string | null;
  createdAt: string;
  order: { id: string; orderNumber: string; itemCount: number; totalMinor: number; vendorOrders: Array<{ id: string; orderNumber: string; businessName: string; subtotalMinor: number }> };
  holds: WalletHoldView[];
  ledgerReferences: Array<{ id: string; purpose: string; direction: string; amountMinor: number; status: string; walletTransactionId: string | null }>;
  events: Array<{ type: string; fromStatus: string | null; toStatus: string | null; createdAt: string }>;
}

export const paymentsApi = {
  listOwn: () => api.get<PaymentCard[]>('/payments'),
  getOwn: (id: string) => api.get<PaymentDetail>(`/payments/${id}`),
  forOrder: (orderId: string) => api.get<PaymentDetail>(`/payments/for-order/${orderId}`),
  authorize: (id: string) => api.post<PaymentDetail>(`/payments/${id}/authorize`),
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  CREATED: 'Created',
  PENDING: 'Pending',
  AUTHORIZED: 'Authorized',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

import { Badge, type Tone } from '../ui';
import { PAYMENT_STATUS_LABEL } from '../../lib/payments';

/** Branded tone per payment status. Deliberately worded so no state implies
 *  settlement or a vendor payout that doesn't exist — funds only ever move
 *  into escrow, never out to a vendor, at this stage. */
const TONE: Record<string, Tone> = {
  CREATED: 'neutral',
  PENDING: 'warning',
  AUTHORIZED: 'success',
  PAID: 'success',
  FAILED: 'error',
  EXPIRED: 'error',
  CANCELLED: 'neutral',
};

const LABEL: Record<string, string> = {
  CREATED: 'Created',
  PENDING: 'Pending authorization',
  AUTHORIZED: 'Authorized',
  PAID: 'Paid',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-belize-blue',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  info: 'bg-sky-500',
};

/** Payment status pill — branded tone system; label text is always shown, status is never color-only. */
export function PaymentStatusBadge({ status }: { status: string }) {
  const tone = TONE[status] ?? 'neutral';
  return (
    <Badge tone={tone}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} aria-hidden />
      {LABEL[status] ?? PAYMENT_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const HOLD_LABEL: Record<string, string> = { HELD: 'Hold placed', AUTHORIZED: 'Escrow hold', RELEASED: 'Hold released' };
const HOLD_TONE: Record<string, Tone> = { HELD: 'warning', AUTHORIZED: 'success', RELEASED: 'neutral' };

export function HoldStatusBadge({ status }: { status: string }) {
  const tone = HOLD_TONE[status] ?? 'neutral';
  return (
    <Badge tone={tone}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} aria-hidden />
      {HOLD_LABEL[status] ?? status}
    </Badge>
  );
}

import { PAYMENT_STATUS_LABEL } from '../../lib/payments';

const TONE: Record<string, string> = {
  CREATED: 'bg-slate-100 text-slate-600',
  PENDING: 'bg-amber-100 text-amber-700',
  AUTHORIZED: 'bg-blue-100 text-blue-700',
  FAILED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

export function PaymentStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {PAYMENT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

const HOLD_LABEL: Record<string, string> = { HELD: 'Hold placed', AUTHORIZED: 'Escrow hold', RELEASED: 'Hold released' };
const HOLD_TONE: Record<string, string> = { HELD: 'bg-amber-50 text-amber-700', AUTHORIZED: 'bg-emerald-50 text-emerald-700', RELEASED: 'bg-slate-100 text-slate-500' };

export function HoldStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${HOLD_TONE[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {HOLD_LABEL[status] ?? status}
    </span>
  );
}

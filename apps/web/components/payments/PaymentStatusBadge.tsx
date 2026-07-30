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

export function HoldStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${status === 'HELD' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
      {status === 'HELD' ? 'Hold placed' : 'Hold released'}
    </span>
  );
}

import { Badge, type Tone } from './ui';

/**
 * Domain status → branded badge. Status is never conveyed by colour alone; the
 * label text is always shown alongside the coloured dot.
 */
const STATUS_TONE: Record<string, Tone> = {
  APPROVED: 'success', ACTIVE: 'success', PAID: 'success', AUTHORIZED: 'success', POSTED: 'success', RELEASED: 'success', DELIVERED: 'success', COMPLETED: 'success', BALANCED: 'success', PUBLISHED: 'success',
  PENDING: 'warning', PENDING_REVIEW: 'warning', MORE_INFO_REQUIRED: 'info', PROCESSING: 'info', HELD: 'info', RESERVED: 'info',
  REJECTED: 'error', FAILED: 'error', CANCELLED: 'error', SUSPENDED: 'warning', UNBALANCED: 'error',
  DRAFT: 'neutral', REVOKED: 'neutral', WITHDRAWN: 'neutral', VOID: 'neutral', DEACTIVATED: 'neutral', ARCHIVED: 'neutral',
};
const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400', brand: 'bg-belize-blue', success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-red-500', info: 'bg-sky-500',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return (
    <Badge tone={tone}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} aria-hidden />
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

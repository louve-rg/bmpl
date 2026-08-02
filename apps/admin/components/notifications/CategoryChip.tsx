import { NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from '@bmpl/shared';
import { Badge, type Tone } from '../ui';

/**
 * Category → branded chip. Colour is always paired with the category label and
 * a dot, so meaning is never conveyed by colour alone.
 */
const CATEGORY_TONE: Record<NotificationCategory, Tone> = {
  ORDER: 'info',
  MESSAGE: 'brand',
  PAYMENT: 'success',
  DELIVERY: 'brand',
  DRIVER: 'brand',
  VENDOR: 'info',
  ACCOUNT: 'neutral',
  ROLE_APPLICATION: 'warning',
  ADMIN_ALERT: 'warning',
  SECURITY: 'error',
  SYSTEM: 'neutral',
  JOB: 'info',
  PROPERTY: 'brand',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-belize-blue',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  info: 'bg-sky-500',
};

export function CategoryChip({ category }: { category: NotificationCategory }) {
  const tone = CATEGORY_TONE[category] ?? 'neutral';
  return (
    <Badge tone={tone}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} aria-hidden />
      {NOTIFICATION_CATEGORY_LABELS[category] ?? category}
    </Badge>
  );
}

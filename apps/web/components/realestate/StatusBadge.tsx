import { PROPERTY_STATUS_LABELS, type PropertyStatus } from '@bmpl/shared';
import { Badge } from '../ui';
import { PROPERTY_STATUS_TONE } from './status';

/** Branded chip for a property-listing status (label + tone, never colour alone). */
export function StatusBadge({
  status,
  className = '',
}: {
  status: PropertyStatus;
  className?: string;
}) {
  return (
    <Badge tone={PROPERTY_STATUS_TONE[status]} className={className}>
      {PROPERTY_STATUS_LABELS[status]}
    </Badge>
  );
}

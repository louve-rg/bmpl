import { Badge, StatusBadge } from '../ui';
import { deliveryStatusDisplay, type StageAwareDelivery } from '../../lib/delivery-stage';

/** Order / vendor-order status pill. Delegates to the shared branded StatusBadge tone system. */
export function OrderStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} />;
}

/** Delivery status pill that prefers the server-named pre-dispatch stage
 *  (BMPL-129): while the delivery is waiting on the store or on dispatch, the
 *  pill says so in the server's words instead of the raw status. Once the
 *  stage is absent (dispatched, or an older API), the status badge returns. */
export function DeliveryStatusBadge({ delivery }: { delivery: StageAwareDelivery }) {
  const display = deliveryStatusDisplay(delivery);
  if (display.kind === 'stage') {
    return (
      <Badge tone="info">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-500" aria-hidden />
        {display.label}
      </Badge>
    );
  }
  return <StatusBadge status={display.status} />;
}

/** Small pill for the delivery method. */
export function DeliveryBadge({ method }: { method: string }) {
  return <Badge tone="neutral">{method === 'DELIVERY' ? 'Delivery' : 'Pickup'}</Badge>;
}

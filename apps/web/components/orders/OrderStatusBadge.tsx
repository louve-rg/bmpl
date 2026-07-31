import { Badge, StatusBadge } from '../ui';

/** Order / vendor-order status pill. Delegates to the shared branded StatusBadge tone system. */
export function OrderStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} />;
}

/** Small pill for the delivery method. */
export function DeliveryBadge({ method }: { method: string }) {
  return <Badge tone="neutral">{method === 'DELIVERY' ? 'Delivery' : 'Pickup'}</Badge>;
}

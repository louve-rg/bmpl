const STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
};

/** Order / vendor-order status pill. Only PENDING exists in M10; others render neutral. */
export function OrderStatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? 'bg-slate-100 text-slate-600';
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
  );
}

/** Small pill for the delivery method. */
export function DeliveryBadge({ method }: { method: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
      {method === 'DELIVERY' ? 'Delivery' : 'Pickup'}
    </span>
  );
}

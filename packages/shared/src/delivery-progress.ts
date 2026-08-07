/**
 * The customer-facing delivery timeline (M26.3 · Part 9).
 *
 * Pure and framework-free so it is testable without a database and renders the
 * same on every surface.
 *
 * It exists because the truth about an order's progress is split across two
 * rows: the VENDOR ORDER knows about preparation and readiness, the DELIVERY
 * knows about the driver. The stored DeliveryTimelineEvent log only begins at
 * assignment, so a customer who had paid and was waiting for the shop to pack
 * their order saw an empty timeline and no evidence anything was happening.
 *
 * Steps are always returned in full, including ones not reached yet — a progress
 * indicator that grows as it goes gives no sense of how much is left.
 */

export const DELIVERY_PROGRESS_STEPS = [
  'ORDER_PLACED',
  'PREPARING',
  'READY',
  'DRIVER_ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVING',
  'DELIVERED',
] as const;
export type DeliveryProgressStep = (typeof DELIVERY_PROGRESS_STEPS)[number];

export const DELIVERY_PROGRESS_LABELS: Record<DeliveryProgressStep, string> = {
  ORDER_PLACED: 'Order placed',
  PREPARING: 'Store preparing your order',
  READY: 'Ready for a driver',
  DRIVER_ASSIGNED: 'Driver on the way to the store',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'On the way to you',
  ARRIVING: 'Arriving now',
  DELIVERED: 'Delivered',
};

export type ProgressState = 'DONE' | 'CURRENT' | 'PENDING';

export interface ProgressEntry {
  step: DeliveryProgressStep;
  label: string;
  state: ProgressState;
  at: Date | null;
}

export interface DeliveryProgressInput {
  placedAt: Date | null;
  /** VendorOrder: set when the vendor starts assembling. */
  preparingAt: Date | null;
  /** VendorOrder: set when the vendor marks it packed. */
  readyAt: Date | null;
  assignedAt: Date | null;
  acceptedAt: Date | null;
  pickupConfirmedAt: Date | null;
  inTransitAt: Date | null;
  arrivingAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
}

/**
 * Build the ordered timeline.
 *
 * The CURRENT step is the last one with a timestamp, not the first one without.
 * Those differ whenever a stage is skipped — a vendor who packs an order without
 * pressing "start preparing", say — and picking the first blank would park the
 * indicator on a step that has already been overtaken.
 *
 * A cancelled delivery keeps whatever it achieved and simply has no current
 * step; the caller renders the cancellation itself, which carries a reason this
 * list has no room for.
 */
export function buildDeliveryProgress(input: DeliveryProgressInput): ProgressEntry[] {
  const at: Record<DeliveryProgressStep, Date | null> = {
    ORDER_PLACED: input.placedAt,
    PREPARING: input.preparingAt,
    READY: input.readyAt,
    // Accepting is the meaningful moment for a customer: a driver who was
    // offered the job and never answered is not "on the way".
    DRIVER_ASSIGNED: input.acceptedAt ?? input.assignedAt,
    PICKED_UP: input.pickupConfirmedAt,
    IN_TRANSIT: input.inTransitAt,
    ARRIVING: input.arrivingAt,
    DELIVERED: input.deliveredAt,
  };

  let lastReached = -1;
  DELIVERY_PROGRESS_STEPS.forEach((step, i) => {
    if (at[step]) lastReached = i;
  });

  const cancelled = !!input.cancelledAt;
  const finished = !!input.deliveredAt;

  return DELIVERY_PROGRESS_STEPS.map((step, i) => ({
    step,
    label: DELIVERY_PROGRESS_LABELS[step],
    at: at[step],
    state:
      i < lastReached || (finished && i <= lastReached)
        ? 'DONE'
        : i === lastReached
          ? cancelled
            ? 'DONE'
            : 'CURRENT'
          : 'PENDING',
  }));
}

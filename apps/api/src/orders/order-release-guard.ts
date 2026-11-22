import { ConflictException } from '@nestjs/common';

/**
 * ORD-RELEASED-GUARD: once an admin has released an order's reservations
 * (`Order.reservationsReleasedAt`), the payment has already been returned to
 * the customer (orders.service.ts's `releaseReservationsInTx`). Nothing after
 * that point may move the order forward — the vendor fulfilment transitions
 * (`VendorFulfilmentService`) and the pickup transitions (`PickupService`)
 * each call this at the same point they already check vendor-order status,
 * so a released order can never reach dispatch or collection and leave
 * vendor/driver unpaid for a cancelled payment.
 */
export function assertReservationsNotReleased(reservationsReleasedAt: Date | null): void {
  if (reservationsReleasedAt) {
    throw new ConflictException("This order's payment was returned to the customer; it can no longer be fulfilled.");
  }
}

/**
 * Dispatch predicates both dispatch surfaces have to agree about.
 *
 * Lives here, under `dispatch/`, rather than in `shipping/`, because
 * `shipping/` already imports `dispatch/` (ShipmentDispatchService ->
 * DispatchEngineService) and the reverse import would make the two modules
 * circular. Pure functions, no Prisma, no Nest — they take the narrowest
 * object shape that answers the question.
 */

/**
 * THE payment invariant: an unpaid shipment must never become a driver's job.
 *
 * Stated once and used by both the automatic path (ShipmentDispatchService.
 * dispatchLeg, via its own `isPaidFor`) and the driver-initiated claim path
 * (UnclaimedJobsService), which is the whole point of it being here — a claim
 * that checked this a second, slightly different way would eventually let a
 * driver pull an unpaid parcel that automatic dispatch correctly refused to
 * offer.
 *
 * A free shipment is payable-by-definition: nothing was owed, so nothing can
 * be outstanding. That also keeps journeys booked before shipment payments
 * existed dispatchable, rather than stranding them.
 */
export function isShipmentPaidForDispatch(shipment: {
  quotedTotalMinor: bigint;
  payment: { status: string } | null;
}): boolean {
  if (shipment.quotedTotalMinor <= 0n) return true;
  const status = shipment.payment?.status;
  return status === 'AUTHORIZED' || status === 'SETTLING' || status === 'SETTLED';
}

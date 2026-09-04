/**
 * Which manual dispatch action, if any, a shipment courier leg admits.
 *
 * The rules are not restated here — they are imported from @bmpl/shared, the
 * same `canPerform` state machine and `isLegActionable` check the API runs in
 * ShipmentDispatchService.assignManual. The UI asking the same authority the
 * server consults is what keeps a button from being an invitation to a 400.
 */
import { canPerform, isLegActionable, type DeliveryStatus, type LegView } from '@bmpl/shared';

/** The slice of an ops-board leg row this decision needs. */
export interface AssignableLeg {
  sequence: number;
  kind: string;
  status: string;
  courierStatus: string | null;
}

export type LegAssignMode = 'assign' | 'reassign';

export function legAssignMode(legs: readonly AssignableLeg[], leg: AssignableLeg): LegAssignMode | null {
  // A transport leg is operated by a carrier, not a driver — same refusal the
  // API gives, decided before showing a control rather than after clicking it.
  if (leg.kind === 'LINE_HAUL') return null;
  // No driver is sent where the parcel is not. isLegActionable reads only
  // sequence and status, so the ops rows satisfy it; the cast mirrors the API's
  // own `leg.shipment.legs as LegView[]`.
  if (!isLegActionable(legs as unknown as readonly LegView[], leg.sequence)) return null;
  // A never-offered leg has courierStatus null, which means PENDING_ASSIGNMENT.
  const current = (leg.courierStatus ?? 'PENDING_ASSIGNMENT') as DeliveryStatus;
  if (canPerform('ASSIGN', current)) return 'assign';
  if (canPerform('REASSIGN', current)) return 'reassign';
  return null;
}

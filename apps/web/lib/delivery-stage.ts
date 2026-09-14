/**
 * Pre-dispatch stage display rule (BMPL-129, Edward UAT round 2, D1).
 *
 * "Awaiting driver" used to appear from the moment of checkout, while the
 * store was still packing — the status enum genuinely cannot tell those
 * situations apart. BMPL-128 adds `stage` / `stageLabel` to the order
 * delivery payload for the pre-dispatch phases (waiting on the vendor,
 * waiting on dispatch, offered to a driver); after dispatch the stage is
 * absent and the status is the truth again.
 *
 * The rule: when the server names a stage, show the server's sentence for it;
 * otherwise show the status badge exactly as before. An older API that sends
 * no stage fields therefore renders identically to today (deploy-window safe),
 * and the client never re-derives which party the delivery is waiting on —
 * only the server knows that.
 */

export interface StageAwareDelivery {
  status: string;
  stage?: string | null;
  stageLabel?: string | null;
}

export type DeliveryStatusDisplay =
  | { kind: 'stage'; label: string }
  | { kind: 'status'; status: string };

export function deliveryStatusDisplay(d: StageAwareDelivery): DeliveryStatusDisplay {
  if (d.stage && d.stageLabel) return { kind: 'stage', label: d.stageLabel };
  return { kind: 'status', status: d.status };
}

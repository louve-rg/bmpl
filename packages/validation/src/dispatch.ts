import { z } from 'zod';

/**
 * Dispatch & Delivery Execution (Phase 4 · M15) request schemas. All dispatch
 * mutations are Zod-validated at the controller boundary; ownership / role /
 * permission / state-machine checks happen in the services.
 */

const cuid = z.string().cuid2().or(z.string().cuid());
const storageKey = z.string().trim().min(1).max(512);
const reason = z.string().trim().min(1, 'A reason is required.').max(500);

/** A pickup / delivery verification PIN (numeric; leading zeros preserved). */
const pin = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, 'Enter the numeric code.');

/** Admin assigns an eligible driver (+ one of their approved vehicles) to a delivery. */
export const assignDeliverySchema = z.object({
  driverProfileId: cuid,
  vehicleId: cuid,
});
export type AssignDeliveryInput = z.infer<typeof assignDeliverySchema>;

/** Admin reassigns to a different driver; a reason is mandatory (preserves history). */
export const reassignDeliverySchema = z.object({
  driverProfileId: cuid,
  vehicleId: cuid,
  reason,
});
export type ReassignDeliveryInput = z.infer<typeof reassignDeliverySchema>;

/** Admin cancels an assignment (only legal before pickup). Reason mandatory. */
export const cancelDeliverySchema = z.object({ reason });
export type CancelDeliveryInput = z.infer<typeof cancelDeliverySchema>;

/** Driver declines an assignment; a reason is mandatory. */
export const declineJobSchema = z.object({ reason });
export type DeclineJobInput = z.infer<typeof declineJobSchema>;

/** Driver confirms pickup by submitting the vendor-held pickup PIN. Also reused by
 *  vendor pickup-collection confirmation (M18.1). */
export const confirmPickupSchema = z.object({ pin });
export type ConfirmPickupInput = z.infer<typeof confirmPickupSchema>;

/** Admin override for pickup collection (M18.1) — requires a reason, no PIN. */
export const pickupOverrideSchema = z.object({ reason });
export type PickupOverrideInput = z.infer<typeof pickupOverrideSchema>;

/** Driver completes delivery: recipient PIN + recipient name (+ optional notes/POD). */
export const confirmDeliverySchema = z.object({
  pin,
  recipientName: z.string().trim().min(1, 'Recipient name is required.').max(160),
  notes: z.string().trim().max(1000).optional(),
  podPhotoKeys: z.array(storageKey).max(6).optional(),
});
export type ConfirmDeliveryInput = z.infer<typeof confirmDeliverySchema>;

/** Attach proof-of-delivery photo keys (uploaded via presign) before completion. */
export const podConfirmSchema = z.object({
  photoKeys: z.array(storageKey).min(1).max(6),
});
export type PodConfirmInput = z.infer<typeof podConfirmSchema>;
